import { brandMarkUrl } from "../publicAssets.js";

type BrandMarkProps = {
  compact?: boolean;
};

export function BrandMark({ compact = false }: BrandMarkProps) {
  return <img className={compact ? "brandMark compact" : "brandMark"} src={brandMarkUrl} alt="" aria-hidden="true" draggable={false} />;
}
