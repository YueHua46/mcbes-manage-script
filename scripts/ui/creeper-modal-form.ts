import type { Player, RawMessage } from "@minecraft/server";
import {
  ModalFormData as MinecraftModalFormData,
  type ModalFormDataDropdownOptions,
  type ModalFormDataSliderOptions,
  type ModalFormDataTextFieldOptions,
  type ModalFormDataToggleOptions,
  type ModalFormResponse,
} from "@minecraft/server-ui";
import { applyCreeperTextPalette, neutralizeCreeperTitle } from "./creeper-text-palette";

export const CREEPER_MODAL_FORM_PREFIX = "/CMMODAL ";

function routedTitle(title: RawMessage | string): RawMessage | string {
  const visibleTitle = neutralizeCreeperTitle(title);
  if (typeof visibleTitle === "string") return `${CREEPER_MODAL_FORM_PREFIX}${visibleTitle}`;
  return { rawtext: [{ text: CREEPER_MODAL_FORM_PREFIX }, visibleTitle] };
}

/**
 * Project-owned ModalFormData facade. The private title prefix routes only
 * CreeperMenu forms into the themed custom-form branch in server_form.json.
 */
export class CreeperModalFormData {
  private readonly form = new MinecraftModalFormData().title(`${CREEPER_MODAL_FORM_PREFIX}功能设置`);

  title(titleText: RawMessage | string): CreeperModalFormData {
    this.form.title(routedTitle(titleText));
    return this;
  }

  label(text: RawMessage | string): CreeperModalFormData {
    this.form.label(applyCreeperTextPalette(text));
    return this;
  }

  header(text: RawMessage | string): CreeperModalFormData {
    this.form.header(applyCreeperTextPalette(text));
    return this;
  }

  divider(): CreeperModalFormData {
    this.form.divider();
    return this;
  }

  dropdown(
    label: RawMessage | string,
    items: (RawMessage | string)[],
    dropdownOptions?: ModalFormDataDropdownOptions
  ): CreeperModalFormData {
    this.form.dropdown(applyCreeperTextPalette(label), applyCreeperTextPalette(items), dropdownOptions);
    return this;
  }

  slider(
    label: RawMessage | string,
    minimumValue: number,
    maximumValue: number,
    sliderOptions?: ModalFormDataSliderOptions
  ): CreeperModalFormData {
    this.form.slider(applyCreeperTextPalette(label), minimumValue, maximumValue, sliderOptions);
    return this;
  }

  textField(
    label: RawMessage | string,
    placeholderText: RawMessage | string,
    textFieldOptions?: ModalFormDataTextFieldOptions
  ): CreeperModalFormData {
    this.form.textField(applyCreeperTextPalette(label), applyCreeperTextPalette(placeholderText), textFieldOptions);
    return this;
  }

  toggle(label: RawMessage | string, toggleOptions?: ModalFormDataToggleOptions): CreeperModalFormData {
    this.form.toggle(applyCreeperTextPalette(label), toggleOptions);
    return this;
  }

  submitButton(submitButtonText: RawMessage | string): CreeperModalFormData {
    this.form.submitButton(applyCreeperTextPalette(submitButtonText));
    return this;
  }

  show(player: Player): Promise<ModalFormResponse> {
    return this.form.show(player);
  }
}
