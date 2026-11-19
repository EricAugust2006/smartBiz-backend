import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AskCopilotDto {
  @IsString({ message: 'A pergunta deve ser um texto.' })
  @IsNotEmpty({ message: 'Informe uma pergunta para o Copiloto.' })
  @MaxLength(2000, { message: 'A pergunta deve ter no máximo 2.000 caracteres.' })
  question: string;
}
