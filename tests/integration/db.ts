/**
 * Base de datos Postgres real en memoria (PGlite) que imita lo esencial de Supabase:
 * roles `anon` / `authenticated`, esquema `auth` con `auth.uid()`, privilegios por defecto
 * (Supabase concede TODO a anon/authenticated en tablas y funciones nuevas: la migración
 * debe retirarlos) y la publicación `supabase_realtime`.
 *
 * Cada llamada `as(uid)` se ejecuta en su propia transacción con el rol `authenticated`,
 * igual que una petición a la API de Supabase.
 */
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MIGRATION = fileURLToPath(new URL('../../supabase/migrations/20261019000000_unisono.sql', import.meta.url));

const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
create table auth.users (id uuid primary key, is_anonymous boolean not null default true);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create publication supabase_realtime;
`;

export class GameError extends Error {}

export interface TestDb {
  db: PGlite;
  /** Crea un usuario anónimo y devuelve su uid. */
  newUser(): Promise<string>;
  /** Ejecuta SQL como el usuario `uid` (rol authenticated). */
  as<T = Record<string, unknown>>(uid: string, sql: string, params?: unknown[]): Promise<T[]>;
  /** Ejecuta SQL con el rol `anon` (sin sesión). */
  asAnon<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Llama a una función RPC como `uid` y devuelve su JSON. Lanza GameError(código). */
  rpc<T = any>(uid: string, fn: string, args: Record<string, unknown>): Promise<T>;
  /** SQL como superusuario (solo para preparar escenarios y comprobar resultados). */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(readFileSync(MIGRATION, 'utf8'));

  async function run<T>(role: string, uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    return db.transaction(async (tx: Transaction) => {
      await tx.exec(`set local role ${role};`);
      if (uid) await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
      const res = await tx.query<T>(sql, params);
      return res.rows;
    });
  }

  return {
    db,
    async newUser() {
      const id = randomUUID();
      await db.query('insert into auth.users (id) values ($1)', [id]);
      return id;
    },
    as: (uid, sql, params) => run('authenticated', uid, sql, params),
    asAnon: (sql, params) => run('anon', null, sql, params),
    async rpc(uid, fn, args) {
      const names = Object.keys(args);
      const call = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
      const values = names.map((n) => {
        const v = args[n];
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      });
      try {
        const rows = await run<{ r: any }>('authenticated', uid, call, values);
        return rows[0]!.r;
      } catch (e) {
        throw new GameError((e as Error).message);
      }
    },
    async admin(sql, params = []) {
      const res = await db.query(sql, params);
      return res.rows as any[];
    },
  };
}

/** Devuelve el código de error de una promesa que debe fallar. */
export async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return 'OK';
}
