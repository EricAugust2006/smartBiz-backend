import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { requireTenant } from '@common/utils/require-tenant';

const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_TIMEOUT_MS = 15_000;
const EXPIRING_WINDOW_DAYS = 7;
const MAX_PRODUCTS_IN_PROMPT = 20;

interface ProductMetrics {
  name: string;
  trackStock: boolean;
  quantity: number;
  minQuantity: number;
  price: number;
  costPrice: number;
  expiresAt: Date | null;
}

interface CopilotContext {
  revenueTodayBrl: string;
  revenueMonthBrl: string;
  todaySalesCount: number;
  averageTicketBrl: string;
  lowStockCount: number;
  lowStockProducts: Array<{
    name: string;
    quantity: number;
    minQuantity: number;
    priceBrl: string;
    costPriceBrl: string;
  }>;
  expiringCount: number;
  expiringProducts: Array<{
    name: string;
    quantity: number;
    expiresAt: string;
    priceBrl: string;
    costPriceBrl: string;
  }>;
  vipMetrics: {
    totalCustomers: number;
    vipMembers: number;
    vipMembershipPercent: number;
    vipPoints: number;
  };
}

class GeminiHttpError extends Error {
  constructor(readonly status: number, readonly responseBody: string) {
    super(`Gemini retornou HTTP ${status}: ${responseBody}`);
    this.name = 'GeminiHttpError';
  }
}

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function formatBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractGeminiText(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return null;

  const candidate = payload.candidates.find(isRecord);
  if (!candidate || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return null;

  const answer = candidate.content.parts
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .filter((part) => part.length > 0)
    .join('\n')
    .trim();

  return answer || null;
}

@Injectable()
export class AiCopilotService {
  private readonly logger = new Logger(AiCopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async askCopilot(tenantId: string, question: string): Promise<{ answer: string }> {
    requireTenant(tenantId);
    const context = await this.getStoreContext(tenantId);

    try {
      const answer = await this.askGemini(question, context);
      return { answer };
    } catch (error: unknown) {
      this.logGeminiFailure(error);
      return { answer: this.createDataFallback(context) };
    }
  }

  private async getStoreContext(tenantId: string): Promise<CopilotContext> {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const expiresBefore = new Date(now);
    expiresBefore.setDate(expiresBefore.getDate() + EXPIRING_WINDOW_DAYS);

    const [todayRevenue, monthRevenue, todaySalesCount, totalCustomers, vipMembers, vipPoints, products] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { tenantId, type: 'SALE', createdAt: { gte: todayStart, lte: now } },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { tenantId, type: 'SALE', createdAt: { gte: monthStart, lte: now } },
        _sum: { amount: true },
      }),
      this.prisma.transaction.count({
        where: { tenantId, type: 'SALE', createdAt: { gte: todayStart, lte: now } },
      }),
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.customer.count({ where: { tenantId, isVipMember: true } }),
      this.prisma.customer.aggregate({
        where: { tenantId, isVipMember: true },
        _sum: { points: true },
      }),
      this.prisma.product.findMany({
        where: { tenantId, isActive: true },
        select: {
          name: true,
          trackStock: true,
          quantity: true,
          minQuantity: true,
          price: true,
          costPrice: true,
          expiresAt: true,
        },
      }),
    ]);

    const contextData = {
      revenueToday: toNumber(todayRevenue._sum.amount ?? 0),
      revenueMonth: toNumber(monthRevenue._sum.amount ?? 0),
      todaySalesCount,
      totalCustomers,
      vipMembers,
      vipPoints: vipPoints._sum.points ?? 0,
      products: products.map((product): ProductMetrics => ({
        name: product.name,
        trackStock: product.trackStock,
        quantity: toNumber(product.quantity ?? 0),
        minQuantity: toNumber(product.minQuantity ?? 0),
        price: toNumber(product.price ?? 0),
        costPrice: toNumber(product.costPrice ?? 0),
        expiresAt: product.expiresAt,
      })),
    };

    const averageTicket = contextData.todaySalesCount === 0
      ? 0
      : contextData.revenueToday / contextData.todaySalesCount;
    const lowStockProducts = contextData.products
      .filter((product) => product.trackStock && product.quantity <= product.minQuantity)
      .sort((left, right) => left.quantity - right.quantity || left.name.localeCompare(right.name));
    const expiringProducts = contextData.products
      .filter((product) => product.expiresAt !== null && product.expiresAt >= now && product.expiresAt <= expiresBefore)
      .sort((left, right) => {
        const leftExpiresAt = left.expiresAt?.getTime() ?? 0;
        const rightExpiresAt = right.expiresAt?.getTime() ?? 0;
        return leftExpiresAt - rightExpiresAt || left.name.localeCompare(right.name);
      });

    return {
      revenueTodayBrl: formatBrl(contextData.revenueToday),
      revenueMonthBrl: formatBrl(contextData.revenueMonth),
      todaySalesCount: contextData.todaySalesCount,
      averageTicketBrl: formatBrl(averageTicket),
      lowStockCount: lowStockProducts.length,
      lowStockProducts: lowStockProducts.slice(0, MAX_PRODUCTS_IN_PROMPT).map((product) => ({
        name: product.name,
        quantity: product.quantity,
        minQuantity: product.minQuantity,
        priceBrl: formatBrl(product.price),
        costPriceBrl: formatBrl(product.costPrice),
      })),
      expiringCount: expiringProducts.length,
      expiringProducts: expiringProducts.slice(0, MAX_PRODUCTS_IN_PROMPT).flatMap((product) => {
        if (product.expiresAt === null) return [];
        return [{
          name: product.name,
          quantity: product.quantity,
          expiresAt: product.expiresAt.toISOString(),
          priceBrl: formatBrl(product.price),
          costPriceBrl: formatBrl(product.costPrice),
        }];
      }),
      vipMetrics: {
        totalCustomers: contextData.totalCustomers,
        vipMembers: contextData.vipMembers,
        vipMembershipPercent: contextData.totalCustomers === 0
          ? 0
          : Number(((contextData.vipMembers / contextData.totalCustomers) * 100).toFixed(1)),
        vipPoints: contextData.vipPoints,
      },
    };
  }

  private async askGemini(question: string, context: CopilotContext): Promise<string> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')?.trim()
      || this.config.get<string>('GOOGLE_API_KEY')?.trim();
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY/GOOGLE_API_KEY não configurada; o Copiloto usará o fallback com dados da loja.');
      throw new Error('GEMINI_API_KEY/GOOGLE_API_KEY não está configurada.');
    }

    const configuredModel = this.config.get<string>('GEMINI_MODEL')?.trim() || DEFAULT_GEMINI_MODEL;
    const models = [...new Set([
      configuredModel,
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
    ])];
    const requestBody = JSON.stringify({
      systemInstruction: {
        parts: [{
          text: [
            'Você é um consultor prático de varejo do SmartBiz AI e responde em português do Brasil.',
            'Seja direto, objetivo e conciso, com frases curtas e tópicos curtos ao listar produtos.',
            'Baseie-se exclusivamente nos dados reais de contexto da loja; não invente valores, causas ou tendências.',
            'Formate todo valor monetário em Real (R$ 0,00).',
            'Destaque ações prioritárias para estoque baixo e produtos próximos do vencimento, quando existirem.',
            'Quando houver oportunidade, sugira uma ação simples de engajamento para o Clube VIP com base nas métricas disponíveis.',
            'Se o contexto não trouxer dados suficientes para responder, informe essa limitação com clareza.',
            `Contexto real da loja: ${JSON.stringify(context)}`,
          ].join(' '),
        }],
      },
      contents: [{ role: 'user', parts: [{ text: question }] }],
      generationConfig: { temperature: 0.2 },
    });

    for (const [index, model] of models.entries()) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: requestBody,
          signal: controller.signal,
        });

        if (!response.ok) {
          const responseBody = await response.text();
          throw new GeminiHttpError(response.status, responseBody);
        }

        const payload: unknown = await response.json();
        const answer = extractGeminiText(payload);
        if (!answer) throw new Error('Gemini retornou uma resposta sem texto.');
        return answer;
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          throw new Error(`A chamada ao Gemini excedeu o timeout de ${GEMINI_TIMEOUT_MS} ms.`);
        }

        const nextModel = models[index + 1];
        const canRetryWithNextModel = error instanceof GeminiHttpError
          && (error.status === 503 || error.status === 429)
          && nextModel !== undefined;
        if (!canRetryWithNextModel) throw error;

        this.logger.warn(
          `Gemini retornou HTTP ${error.status} para o modelo ${model}; alternando para ${nextModel}.`,
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error('Nenhum modelo Gemini retornou uma resposta válida.');
  }

  private logGeminiFailure(error: unknown): void {
    if (error instanceof GeminiHttpError) {
      this.logger.error(
        `Falha na chamada do Gemini (status HTTP ${error.status}; corpo de erro: ${error.responseBody})`,
        error.stack,
      );
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(`Falha na chamada do Gemini (status HTTP indisponível): ${message}`, stack);
  }

  private createDataFallback(context: CopilotContext): string {
    const lowStockSummary = context.lowStockProducts.length === 0
      ? 'nenhum item identificado'
      : context.lowStockProducts.slice(0, 5)
        .map((product) => `${product.name} (${product.quantity} un.; mínimo ${product.minQuantity})`)
        .join(', ');
    const expiringSummary = context.expiringProducts.length === 0
      ? 'nenhum item nos próximos 7 dias'
      : context.expiringProducts.slice(0, 5)
        .map((product) => `${product.name} (${new Intl.DateTimeFormat('pt-BR').format(new Date(product.expiresAt))})`)
        .join(', ');
    const vipPercent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
      .format(context.vipMetrics.vipMembershipPercent);

    return [
      'A análise generativa está temporariamente indisponível. Seguem os dados atuais da loja:',
      `Faturamento: hoje ${context.revenueTodayBrl}; no mês ${context.revenueMonthBrl}.`,
      `Ticket médio de hoje: ${context.averageTicketBrl} em ${context.todaySalesCount} venda(s).`,
      `Estoque baixo: ${context.lowStockCount} produto(s). ${lowStockSummary}.`,
      `Próximos do vencimento: ${context.expiringCount} produto(s). ${expiringSummary}.`,
      `Clube VIP: ${context.vipMetrics.vipMembers} membro(s) de ${context.vipMetrics.totalCustomers} cliente(s) (${vipPercent}%); ${context.vipMetrics.vipPoints} ponto(s) acumulados.`,
    ].join(' ');
  }
}
