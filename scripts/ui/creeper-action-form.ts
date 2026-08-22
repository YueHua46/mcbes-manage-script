import { system, type Player, type RawMessage } from "@minecraft/server";
import { ActionFormData as MinecraftActionFormData, type ActionFormResponse } from "@minecraft/server-ui";

export const CREEPER_ACTION_FORM_PREFIX = "/CMFORM ";
export const CREEPER_FORM_TRANSITION_TICKS = 4;

/** Let the client finish dismissing the previous server form before opening another one. */
export async function waitForCreeperFormTransition(): Promise<void> {
  await system.waitTicks(CREEPER_FORM_TRANSITION_TICKS);
}

function routedTitle(title: RawMessage | string): RawMessage | string {
  if (typeof title === "string") return `${CREEPER_ACTION_FORM_PREFIX}${title}`;
  return { rawtext: [{ text: CREEPER_ACTION_FORM_PREFIX }, title] };
}

/**
 * Project-owned ActionFormData wrapper. Prefixing titles lets the resource
 * pack theme CreeperMenu forms without replacing forms from other add-ons.
 */
export class CreeperActionFormData {
  private readonly form = new MinecraftActionFormData();

  title(titleText: RawMessage | string): CreeperActionFormData {
    this.form.title(routedTitle(titleText));
    return this;
  }

  body(bodyText: RawMessage | string): CreeperActionFormData {
    this.form.body(bodyText);
    return this;
  }

  button(text: RawMessage | string, iconPath?: string): CreeperActionFormData {
    this.form.button(text, iconPath);
    return this;
  }

  divider(): CreeperActionFormData {
    this.form.divider();
    return this;
  }

  header(text: RawMessage | string): CreeperActionFormData {
    this.form.header(text);
    return this;
  }

  label(text: RawMessage | string): CreeperActionFormData {
    this.form.label(text);
    return this;
  }

  async show(player: Player): Promise<ActionFormResponse> {
    await waitForCreeperFormTransition();
    return this.form.show(player);
  }
}
