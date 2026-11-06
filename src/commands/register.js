import { REST, Routes } from 'discord.js';
import { commands } from './definitions.js';
import { logger } from '../services/logger.js';

/** Overwrites the global command set (idempotent — safe on every boot). */
export async function registerCommands({ token, applicationId }) {
  const rest = new REST({ version: '10' }).setToken(token);
  const result = await rest.put(Routes.applicationCommands(applicationId), { body: commands });
  logger.info({ count: result.length }, 'global commands registered');
  return result;
}
