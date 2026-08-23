import type { Player, RawMessage } from "@minecraft/server";
import { ActionFormData as MinecraftActionFormData, type MessageFormResponse } from "@minecraft/server-ui";
import { applyCreeperTextPalette, neutralizeCreeperTitle } from "./creeper-text-palette";

export const CREEPER_MESSAGE_FORM_PREFIX = "/CMMESSAGE ";

function routedTitle(title: RawMessage | string): RawMessage | string {
  const visibleTitle = neutralizeCreeperTitle(title);
  if (typeof visibleTitle === "string") return `${CREEPER_MESSAGE_FORM_PREFIX}${visibleTitle}`;
  return { rawtext: [{ text: CREEPER_MESSAGE_FORM_PREFIX }, visibleTitle] };
}

/**
 * Project-owned MessageFormData facade. Its private title namespace routes
 * CreeperMenu two-button messages without styling forms owned by the game or
 * other add-ons.
 */
export class CreeperMessageFormData {
  private titleText: RawMessage | string = "提示";
  private bodyText: RawMessage | string = "";
  private buttonOneText: RawMessage | string = "";
  private buttonTwoText: RawMessage | string = "";

  title(titleText: RawMessage | string): CreeperMessageFormData {
    this.titleText = titleText;
    return this;
  }

  body(bodyText: RawMessage | string): CreeperMessageFormData {
    this.bodyText = bodyText;
    return this;
  }

  button1(text: RawMessage | string): CreeperMessageFormData {
    this.buttonOneText = text;
    return this;
  }

  button2(text: RawMessage | string): CreeperMessageFormData {
    this.buttonTwoText = text;
    return this;
  }

  show(player: Player): Promise<MessageFormResponse> {
    const form = new MinecraftActionFormData()
      .title(routedTitle(this.titleText))
      .body(applyCreeperTextPalette(this.bodyText))
      .button(applyCreeperTextPalette(this.buttonOneText))
      .button(applyCreeperTextPalette(this.buttonTwoText));

    // MessageFormData bypasses the parallel JSON UI factory on current
    // Bedrock clients. ActionFormData reaches the same long_form collection
    // used by the project's proven /CMROOT and /CMFORM routes. Both response
    // types expose canceled, cancelationReason, and selection with identical
    // 0/1 button indices, so the facade remains API-compatible for callers.
    return form.show(player);
  }
}
