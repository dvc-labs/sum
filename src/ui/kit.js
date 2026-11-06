import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { BRAND } from '../config.js';

/** Accent colours. Brand orange is the default for every "normal" card. */
export const ACCENT = Object.freeze({
  brand: BRAND.color,
  success: 0x2ecc71,
  warning: 0xf1c40f,
  danger: 0xe74c3c,
  celebrate: 0xffb000,
});

export const NO_MENTIONS = Object.freeze({ parse: [] });

export const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');
export const ts = (ms, style = 'R') => (ms ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'never');
export const user = (id) => (id ? `<@${id}>` : 'nobody yet');
export const channel = (id) => (id ? `<#${id}>` : '*not set*');

export function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

export function separator(large = false, divider = true) {
  return new SeparatorBuilder()
    .setDivider(divider)
    .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

export function container(accent = ACCENT.brand) {
  return new ContainerBuilder().setAccentColor(accent);
}

export function linkButton(label, url, emoji) {
  const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
  if (emoji) b.setEmoji(emoji);
  return b;
}

export function button(customId, label, style = ButtonStyle.Secondary, { emoji, disabled = false } = {}) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
}

export function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

/** A text block with a button on the right. */
export function sectionWithButton(content, btn) {
  return new SectionBuilder().addTextDisplayComponents(text(content)).setButtonAccessory(btn);
}

/** Simple announcement card: title + body lines (+ optional subtext). */
export function card({ title, body, footer, accent = ACCENT.brand }) {
  const c = container(accent);
  const lines = [title ? `### ${title}` : null, body].filter(Boolean).join('\n');
  c.addTextDisplayComponents(text(lines));
  if (footer) c.addTextDisplayComponents(text(`-# ${footer}`));
  return c;
}

/** Wraps top-level components into a Components v2 message payload. */
export function v2(components, { ephemeral = false } = {}) {
  let flags = MessageFlags.IsComponentsV2;
  if (ephemeral) flags |= MessageFlags.Ephemeral;
  return { components, flags, allowedMentions: NO_MENTIONS };
}

/** Payload for interaction.update(): flags cannot change on edit, so only V2 is set. */
export function v2update(components) {
  return { components, flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS };
}
