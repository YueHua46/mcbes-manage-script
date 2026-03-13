/**
 * DDUI 布局辅助工具
 * 用于为 CustomForm 内容提供统一的留白节奏。
 */

type DduiFormLike = {
  spacer: () => DduiFormLike;
  divider: () => DduiFormLike;
  label: (text: any) => DduiFormLike;
};

export function dduiGap(form: DduiFormLike, count = 1): DduiFormLike {
  for (let i = 0; i < count; i++) {
    form.spacer();
  }
  return form;
}

export function dduiSection(form: DduiFormLike, title: any): DduiFormLike {
  form.divider();
  dduiGap(form);
  form.label(title);
  dduiGap(form);
  return form;
}

export function dduiLead(form: DduiFormLike, text: any): DduiFormLike {
  form.label(text);
  dduiGap(form);
  return form;
}
