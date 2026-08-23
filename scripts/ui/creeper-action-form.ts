import type { Player, RawMessage } from "@minecraft/server";
import { ActionFormData as MinecraftActionFormData, type ActionFormResponse } from "@minecraft/server-ui";

export const CREEPER_ACTION_FORM_PREFIX = "/CMFORM ";
const MINECRAFT_FORMATTING_CODE = /§[0-9a-fk-or]/gi;

type FormElement =
  | { kind: "button"; text: RawMessage | string; iconPath?: string }
  | { kind: "divider" }
  | { kind: "header" | "label"; text: RawMessage | string };

function routedTitle(title: RawMessage | string): RawMessage | string {
  if (typeof title === "string") return `${CREEPER_ACTION_FORM_PREFIX}${title}`;
  return { rawtext: [{ text: CREEPER_ACTION_FORM_PREFIX }, title] };
}

function neutralizeFormatting(value: RawMessage | string): RawMessage | string {
  const visit = (node: unknown): unknown => {
    if (typeof node === "string") return node.replace(MINECRAFT_FORMATTING_CODE, "");
    if (Array.isArray(node)) return node.map(visit);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    }
    return node;
  };

  return visit(value) as RawMessage | string;
}

function resolveImplicitNavigationIcon(text: RawMessage | string): string | undefined {
  if (typeof text !== "string") return undefined;
  const label = text.replace(MINECRAFT_FORMATTING_CODE, "").trim();
  if (label.startsWith("上一页")) return "textures/icons/left_arrow";
  if (label.startsWith("下一页")) return "textures/icons/right_arrow";
  if (label.startsWith("返回") || label.startsWith("关闭")) return "textures/icons/back";
  return undefined;
}

/**
 * Project-owned ActionFormData wrapper. Prefixing titles lets the resource
 * pack theme CreeperMenu forms without replacing forms from other add-ons.
 */
export class CreeperActionFormData {
  private titleText: RawMessage | string = "功能菜单";
  private bodyText?: RawMessage | string;
  private readonly elements: FormElement[] = [];

  title(titleText: RawMessage | string): CreeperActionFormData {
    this.titleText = titleText;
    return this;
  }

  body(bodyText: RawMessage | string): CreeperActionFormData {
    this.bodyText = bodyText;
    return this;
  }

  button(text: RawMessage | string, iconPath?: string): CreeperActionFormData {
    this.elements.push({ kind: "button", text, iconPath: iconPath ?? resolveImplicitNavigationIcon(text) });
    return this;
  }

  divider(): CreeperActionFormData {
    this.elements.push({ kind: "divider" });
    return this;
  }

  header(text: RawMessage | string): CreeperActionFormData {
    this.elements.push({ kind: "header", text });
    return this;
  }

  label(text: RawMessage | string): CreeperActionFormData {
    this.elements.push({ kind: "label", text });
    return this;
  }

  show(player: Player): Promise<ActionFormResponse> {
    const visibleTitle = neutralizeFormatting(this.titleText);
    const form = new MinecraftActionFormData().title(routedTitle(visibleTitle)).body(visibleTitle);

    // The routed title remains private protocol data. The visible title travels
    // through #form_text, whose binding survives the custom JSON UI factory.
    // Preserve the original body as a non-interactive collection item.
    if (this.bodyText !== undefined) form.label(neutralizeFormatting(this.bodyText));

    for (const element of this.elements) {
      if (element.kind === "button") form.button(neutralizeFormatting(element.text), element.iconPath);
      else if (element.kind === "header") form.header(neutralizeFormatting(element.text));
      else if (element.kind === "label") form.label(neutralizeFormatting(element.text));
      else form.divider();
    }

    return form.show(player);
  }
}
