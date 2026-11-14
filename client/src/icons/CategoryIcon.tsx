import {
  Coffee,
  Landmark,
  MapPin,
  Martini,
  Mountain,
  ShoppingBag,
  Store,
  TrainFront,
  TreePine,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { Category } from '../categories';

/** A torii gate. Lucide has no temple icon that says "Japan", so this one is drawn here. */
const Torii: LucideIcon = (({ size = 24, strokeWidth = 2, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M2.5 6.5c3.5 1.6 15.5 1.6 19 0" />
    <path d="M5 11h14" />
    <path d="M7 7v13" />
    <path d="M17 7v13" />
  </svg>
)) as LucideIcon;

const ICONS: Record<Category, LucideIcon> = {
  restaurant: UtensilsCrossed,
  cafe: Coffee,
  bar: Martini,
  temple: Torii,
  museum: Landmark,
  market: Store,
  park: TreePine,
  shop: ShoppingBag,
  viewpoint: Mountain,
  transit: TrainFront,
  other: MapPin,
};

/** The icon for a category. Decorative: the category is always also written out as text. */
export function CategoryIcon({ category, size = 20 }: { category: Category; size?: number }) {
  const Icon = ICONS[category];
  return <Icon size={size} aria-hidden="true" focusable="false" />;
}
