import { Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import setting from "./setting";

export interface JoinPopupAnnouncement {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  updatedAt: string;
}

export const MAX_JOIN_POPUP_ANNOUNCEMENTS = 5;

function normalizeText(text: string): string {
  return text.replace(/\\n/g, "\n").trim();
}

function normalizeAnnouncement(value: Partial<JoinPopupAnnouncement>, index: number): JoinPopupAnnouncement | null {
  const title = normalizeText(String(value.title ?? ""));
  const content = normalizeText(String(value.content ?? ""));
  if (!title || !content) return null;

  return {
    id: String(value.id || `legacy-${index}`),
    title,
    content,
    enabled: value.enabled !== false,
    updatedAt: String(value.updatedAt || ""),
  };
}

function parseAnnouncements(raw: string): JoinPopupAnnouncement[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, index) => normalizeAnnouncement(item, index))
      .filter((item): item is JoinPopupAnnouncement => item !== null)
      .slice(0, MAX_JOIN_POPUP_ANNOUNCEMENTS);
  } catch {
    return [];
  }
}

function saveAnnouncements(announcements: JoinPopupAnnouncement[]): void {
  setting.setState("joinPopupAnnouncements", JSON.stringify(announcements.slice(0, MAX_JOIN_POPUP_ANNOUNCEMENTS)));
}

function createId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function getJoinPopupAnnouncements(): JoinPopupAnnouncement[] {
  return parseAnnouncements(String(setting.getState("joinPopupAnnouncements") || "[]"));
}

export function getEnabledJoinPopupAnnouncements(): JoinPopupAnnouncement[] {
  return getJoinPopupAnnouncements().filter((announcement) => announcement.enabled);
}

export function createJoinPopupAnnouncement(title: string, content: string, enabled: boolean): boolean {
  const announcements = getJoinPopupAnnouncements();
  if (announcements.length >= MAX_JOIN_POPUP_ANNOUNCEMENTS) return false;

  announcements.push({
    id: createId(),
    title: normalizeText(title),
    content: normalizeText(content),
    enabled,
    updatedAt: String(Date.now()),
  });
  saveAnnouncements(announcements);
  return true;
}

export function updateJoinPopupAnnouncement(
  id: string,
  patch: Pick<JoinPopupAnnouncement, "title" | "content" | "enabled">
): boolean {
  const announcements = getJoinPopupAnnouncements();
  const index = announcements.findIndex((announcement) => announcement.id === id);
  if (index < 0) return false;

  announcements[index] = {
    ...announcements[index],
    title: normalizeText(patch.title),
    content: normalizeText(patch.content),
    enabled: patch.enabled,
    updatedAt: String(Date.now()),
  };
  saveAnnouncements(announcements);
  return true;
}

export function setJoinPopupAnnouncementEnabled(id: string, enabled: boolean): boolean {
  const announcements = getJoinPopupAnnouncements();
  const announcement = announcements.find((item) => item.id === id);
  if (!announcement) return false;

  announcement.enabled = enabled;
  announcement.updatedAt = String(Date.now());
  saveAnnouncements(announcements);
  return true;
}

export function deleteJoinPopupAnnouncement(id: string): boolean {
  const announcements = getJoinPopupAnnouncements();
  const next = announcements.filter((announcement) => announcement.id !== id);
  if (next.length === announcements.length) return false;

  saveAnnouncements(next);
  return true;
}

export function renderJoinPopupAnnouncement(announcement: JoinPopupAnnouncement, index: number): string {
  return [
    `§l§b${index + 1}. ${announcement.title}§r`,
    "§8━━━━━━━━━━━━",
    `§f${announcement.content}§r`,
  ].join("\n");
}

export function renderJoinPopupAnnouncements(announcements: JoinPopupAnnouncement[]): string {
  return [
    "§6§l服务器公告§r",
    "§7请阅读以下进服提示，祝你游玩愉快。",
    "",
    announcements.map((announcement, index) => renderJoinPopupAnnouncement(announcement, index)).join("\n\n"),
  ].join("\n");
}

export function showJoinPopupAnnouncements(player: Player): void {
  const announcements = getEnabledJoinPopupAnnouncements();
  if (announcements.length === 0) return;

  const form = new ActionFormData();
  form.title("§w进服公告");
  form.body(renderJoinPopupAnnouncements(announcements));
  form.button("§a我知道了", "textures/icons/accept");
  form.show(player).catch(() => undefined);
}
