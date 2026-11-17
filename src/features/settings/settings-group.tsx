import type { ReactNode } from "react";

export const GROUP_CLASS = "flex flex-col gap-4 border-line border-t py-5 first:border-t-0 first:pt-0 last:pb-0";

export const FIELD_GRID = "grid gap-x-6 gap-y-4 sm:grid-cols-2";

interface GroupHeadingProps {
  readonly action?: ReactNode;
  readonly description?: string | undefined;
  readonly title: string;
}

export function GroupHeading({ action, description, title }: GroupHeadingProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="text-ink text-base font-bold">{title}</h3>

        {description === undefined ? null : <p className="text-ink-soft text-sm leading-snug">{description}</p>}
      </div>

      {action}
    </div>
  );
}

interface SettingsGroupProps extends GroupHeadingProps {
  readonly children?: ReactNode;
}

export function SettingsGroup({ action, children, description, title }: SettingsGroupProps) {
  return (
    <section className={GROUP_CLASS}>
      <GroupHeading action={action} description={description} title={title} />

      {children}
    </section>
  );
}
