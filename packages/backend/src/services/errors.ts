import { Prisma } from '@prisma/client';

export class NotFoundError extends Error {
  constructor(entity: string, id: string | bigint | number) {
    super(`${entity} with id "${id}" not found`);
    this.name = 'NotFoundError';
  }
}

export class UniqueConstraintError extends Error {
  public readonly fields: string[];
  constructor(entity: string, fields: string[]) {
    super(`${entity} already exists (conflict on: ${fields.join(', ')})`);
    this.name = 'UniqueConstraintError';
    this.fields = fields;
  }
}

/**
 * Wraps a Prisma operation and converts well-known Prisma errors into
 * domain errors that can be caught and mapped to HTTP status codes.
 */
export async function withPrismaError<T>(
  entity: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Unique constraint violation
      if (err.code === 'P2002') {
        const target = (err.meta?.target as string[]) ?? [];
        throw new UniqueConstraintError(entity, target);
      }
      // Record not found (update / delete on missing row)
      if (err.code === 'P2025') {
        throw new NotFoundError(entity, 'unknown');
      }
    }
    throw err;
  }
}
