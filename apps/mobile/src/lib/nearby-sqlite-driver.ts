import type { SQLiteDatabase } from 'expo-sqlite';
import type { NearbySQLConnection, NearbySQLDatabase, NearbySQLValue } from '@mastoli/core/nearby-sqlite-synthetic';

/** Structural SDK binding only. Caller must supply an isolated synthetic DB; nothing is opened here. */
function connection(database: SQLiteDatabase): NearbySQLConnection {
  return {
    execAsync: sql => database.execAsync(sql),
    getFirstAsync<T>(sql: string, ...parameters: NearbySQLValue[]): Promise<T | null> {
      return database.getFirstAsync<T>(sql, ...parameters);
    },
    runAsync: (sql, ...parameters) => database.runAsync(sql, ...parameters),
  };
}
export function syntheticNearbySQLiteDriver(database: SQLiteDatabase): NearbySQLDatabase {
  if (database.databasePath.split('/').at(-1) !== 'portofolio-nearby-synthetic-v1.db')
    throw new Error('Use the isolated nearby synthetic database');
  return {
    ...connection(database),
    withExclusiveTransactionAsync: task => database.withExclusiveTransactionAsync(
      transaction => task(connection(transaction)),
    ),
  };
}
