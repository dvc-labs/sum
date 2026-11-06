import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from 'discord.js';

/**
 * Sum keeps its command surface tiny on purpose:
 *  /sum   — the whole game in one panel (stats, leaderboards, players, rules, settings)
 *  /about — version, links and credits
 */
export const commands = [
  new SlashCommandBuilder()
    .setName('sum')
    .setDescription('Open Sum: the count, leaderboards, player stats, rules and settings')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName('about')
    .setDescription('About Sum: version, support server and links')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
].map((c) => c.toJSON());
