import { IsString } from 'class-validator';

export class LetteringSuggestionsDto {
  @IsString()
  accountId: string;
}
