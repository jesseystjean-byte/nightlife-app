// Shared types and onboarding option lists.
export const INTERESTS = ['Live music','DJs / Electronic','Hip-hop','Indie','Jazz','Latin','House','Techno','Comedy','Theater','Art / Gallery','Film','Food / Tasting','Cocktails','Wine','Beer / Brewery','Dance','Karaoke','Trivia','Sports','Outdoor','Festival','Workshop','Meetup','LGBTQ+','Date night','After hours'];
export const VIBES = ['Chill','Energetic','Romantic','Wild','Classy','Underground','Trendy','Cozy','Loud','Intimate'];
export const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export const TIMES = ['Morning','Afternoon','Evening','Late night'];
export const PRICE = ['Free','$','$$','$$$','$$$$'];
export const SETTING = ['Indoor','Outdoor','Either'];
export const COMPANY = ['Solo','Couple','Friends','Date','Group'];
export const CROWD = ['Small','Medium','Large','No preference'];
export const ACCESS = ['Wheelchair access','Quiet space','Sober-friendly','Sensory-friendly'];
export const GENDER = ['Woman','Man','Non-binary','Prefer not to say'];
export const REL = ['Single','Dating','In a relationship','Married','It\u2019s complicated','Prefer not to say'];


export type Profile = {
  name: string; birthYear: number | null; gender: string;
  city: string; maxDistanceKm: number;
  relationship: string; occupation: string; languages: string;
  interests: string[]; vibes: string[];
  priceRange: string[]; daysAvailable: string[]; timesOfDay: string[];
  setting: string; company: string; crowdSize: string;
  accessibility: string[]; notifications: boolean;
  onboardingComplete: boolean;
};

export const EMPTY_PROFILE: Profile = {
  name: '', birthYear: null, gender: '',
  city: '', maxDistanceKm: 25,
  relationship: '', occupation: '', languages: '',
  interests: [], vibes: [],
  priceRange: [], daysAvailable: [], timesOfDay: [],
  setting: 'Either', company: '', crowdSize: 'No preference',
  accessibility: [], notifications: true,
  onboardingComplete: false,
};

export type EventItem = {
  id: string; source: string; title: string;
  startsAt: string; endsAt?: string;
  venue?: string; city?: string; lat?: number; lng?: number;
  url?: string; image?: string;
  price?: { min?: number; max?: number; currency?: string; free?: boolean };
  categories?: string[]; description?: string;
};


export type Loc = { lat?: number; lng?: number; city?: string };
