type BrandMarkProps = {
  compact?: boolean;
};

export function BrandMark({ compact = false }: BrandMarkProps) {
  return <img className={compact ? "brandMark compact" : "brandMark"} src="/brand/queju-icon.svg" alt="" aria-hidden="true" draggable={false} />;
}
