export interface Airport {
  /** The three-letter IATA code, for example "TLV". */
  iata: string;
  name: string;
  city: string;
  countryCode: string;
  countryName: string;
}
