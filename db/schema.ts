import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const state = sqliteTable('state', { key: text('key').primaryKey(), value: text('value').notNull() });
export const lease = sqliteTable('lease', { key: text('key').primaryKey(), token: text('token').notNull(), expires: integer('expires').notNull() });
export const runs = sqliteTable('runs', { id: text('id').primaryKey(), hash: text('hash').notNull(), status: text('status').notNull(), result: text('result'), created: integer('created').notNull() });
export const auth = sqliteTable('auth', {id:text('id').primaryKey(),value:text('value').notNull(),expires:integer('expires').notNull()});
export const rateLimits = sqliteTable('rate_limits', {id:text('id').primaryKey(),count:integer('count').notNull(),expires:integer('expires').notNull()});
