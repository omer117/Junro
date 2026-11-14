/** The fixed list of stage categories. It mirrors the server's list. */
export const CATEGORIES = [
  'restaurant',
  'cafe',
  'bar',
  'temple',
  'museum',
  'market',
  'park',
  'shop',
  'viewpoint',
  'transit',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  restaurant: 'Restaurant',
  cafe: 'Cafe',
  bar: 'Bar',
  temple: 'Temple',
  museum: 'Museum',
  market: 'Market',
  park: 'Park',
  shop: 'Shop',
  viewpoint: 'Viewpoint',
  transit: 'Transit stop',
  other: 'Other',
};
