import type { Player, RawMessage } from "@minecraft/server";
import {
  ModalFormData as MinecraftModalFormData,
  type ModalFormDataDropdownOptions,
  type ModalFormDataSliderOptions,
  type ModalFormDataTextFieldOptions,
  type ModalFormDataToggleOptions,
  type ModalFormResponse,
} from "@minecraft/server-ui";

export const CREEPER_MODAL_FORM_PREFIX = "/CMMODAL ";
const MINECRAFT_FORMATTING_CODE = /§[0-9a-fk-or]/gi;

function neutralizeFormatting<T>(value: T): T {
  const visit = (node: unknown): unknown => {
    if (typeof node === "string") return node.replace(MINECRAFT_FORMATTING_CODE, "");
    if (Array.isArray(node)) return node.map(visit);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    }
    return node;
  };

  return visit(value) as T;
}

function routedTitle(title: RawMessage | string): RawMessage | string {
  const visibleTitle = neutralizeFormatting(title);
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
    this.form.label(neutralizeFormatting(text));
    return this;
  }

  header(text: RawMessage | string): CreeperModalFormData {
    this.form.header(neutralizeFormatting(text));
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
    this.form.dropdown(neutralizeFormatting(label), neutralizeFormatting(items), neutralizeFormatting(dropdownOptions));
    return this;
  }

  slider(
    label: RawMessage | string,
    minimumValue: number,
    maximumValue: number,
    sliderOptions?: ModalFormDataSliderOptions
  ): CreeperModalFormData {
    this.form.slider(neutralizeFormatting(label), minimumValue, maximumValue, neutralizeFormatting(sliderOptions));
    return this;
  }

  textField(
    label: RawMessage | string,
    placeholderText: RawMessage | string,
    textFieldOptions?: ModalFormDataTextFieldOptions
  ): CreeperModalFormData {
    this.form.textField(
      neutralizeFormatting(label),
      neutralizeFormatting(placeholderText),
      neutralizeFormatting(textFieldOptions)
    );
    return this;
  }

  toggle(label: RawMessage | string, toggleOptions?: ModalFormDataToggleOptions): CreeperModalFormData {
    this.form.toggle(neutralizeFormatting(label), neutralizeFormatting(toggleOptions));
    return this;
  }

  submitButton(submitButtonText: RawMessage | string): CreeperModalFormData {
    this.form.submitButton(neutralizeFormatting(submitButtonText));
    return this;
  }

  show(player: Player): Promise<ModalFormResponse> {
    return this.form.show(player);
  }
}
