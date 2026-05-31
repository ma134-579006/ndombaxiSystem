import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca um endpoint como público (sem autenticação JWT). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
