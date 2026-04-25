// Recipients for personalized fuel plan emails
// Lookup supports: email (case-insensitive), truck number (digits), or driver code (case-insensitive)

export interface Recipient {
  first: string
  last: string
  handle?: string | null
  email: string
  truckNumber?: number | null
  driverCode?: string | null
}

export const FUEL_RECIPIENTS: Recipient[] = [
  { first: 'Thomas',  last: 'Sundahl',     handle: 'swampdog',            email: 'tgsundahl1@icloud.com',        truckNumber: 19, driverCode: 'SUNTH' },
  { first: 'Charles', last: 'La Chapelle', handle: null,                  email: 'jimmiekitt@att.net',           truckNumber: 29, driverCode: 'LACC' },
  { first: 'Willie',  last: 'Rogers',      handle: null,                  email: 'willierayrogers@gmail.com',    truckNumber: 30, driverCode: 'ROGW' },
  { first: 'Rafael',  last: 'Ruggierio',   handle: null,                  email: 'Quarkymuon8@icloud.com',       truckNumber: 23, driverCode: 'RUGR' },
  { first: 'Andy',    last: 'Hernandez',   handle: null,                  email: 'hwydrifter@yahoo.com',         truckNumber: 22, driverCode: 'HERA' },
  { first: 'James',   last: 'Wargha',      handle: null,                  email: 'warjam340@yahoo.com',          truckNumber: 17, driverCode: 'WARJ' },
  { first: 'Jamie',   last: 'Blankenship', handle: null,                  email: 'Jmblankenship110@gmail.com',   truckNumber: 18, driverCode: 'BLAJA' },
  { first: 'Howard',  last: 'Gilory',      handle: 'GodFather',           email: 'howardguillory513@gmail.com',  truckNumber: 24, driverCode: 'GILH' },
  { first: 'Kevin',   last: 'Frietsch',    handle: 'Fritter',             email: 'kevinfrietsch@hotmail.com',    truckNumber: 27, driverCode: 'FRIK' },
  { first: 'John',    last: 'Hunter',      handle: null,                  email: 'JOHNBIGDOG70@YAHOO.COM',       truckNumber: 28, driverCode: 'HUNJ' },
  { first: 'Troy',    last: 'Rusk',        handle: 'Needle Bender 9250',  email: 'RUSK.T.A@GMAIL.COM',           truckNumber: 26, driverCode: 'RUSTROCA' },
  { first: 'Marie',   last: 'Nelson',      handle: null,                  email: 'fireyredhead57@gmail.com',     truckNumber: 25, driverCode: 'NELM' },
  { first: 'Jaden',   last: 'Simon',       handle: null,                  email: 'jsimon@simonexpress.com',      truckNumber: null, driverCode: null },
  { first: 'Rusty',   last: 'Fullmer',     handle: 'Roosty',              email: 'rfullmer@simonexpress.com',    truckNumber: null, driverCode: null },
  { first: 'Jaxon',   last: 'Simon',       handle: null,                  email: 'jax@simonexpress.com',         truckNumber: null, driverCode: null },
  { first: 'Cameron', last: 'Perkins',     handle: null,                  email: 'cperkins@simonexpress.com',    truckNumber: null, driverCode: null },
  { first: 'Jordan',  last: 'Simon',       handle: 'Choncho',             email: 'jordan@simonexpress.com',      truckNumber: null, driverCode: null },
  { first: 'Ethan',   last: 'Fishback',    handle: null,                  email: 'efishback@simonexpress.com',   truckNumber: null, driverCode: null },
  { first: 'Chas',    last: 'Simon',       handle: null,                  email: 'csimon@simonexpress.com',      truckNumber: null, driverCode: null },
  { first: 'TeJay',   last: 'Simon',       handle: null,                  email: 'tsimon@simonexpress.com',      truckNumber: null, driverCode: null },
  { first: 'Jason',   last: 'Fishback',    handle: 'Fish',                email: 'jfishback@simonexpress.com',   truckNumber: null, driverCode: null },
]

/** Find recipient by email address (case-insensitive). */
export function findRecipient(email: string): Recipient | null {
  const normalized = email.trim().toLowerCase()
  return FUEL_RECIPIENTS.find(r => r.email.toLowerCase() === normalized) || null
}

/**
 * Look up recipients by input — email, truck number, or driver code.
 * Returns matching recipients (empty if no match found).
 */
export function lookupRecipients(input: string): Recipient[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  // Email
  if (trimmed.includes('@')) {
    const match = findRecipient(trimmed)
    return match ? [match] : []
  }

  // Truck number (pure digits)
  if (/^\d+$/.test(trimmed)) {
    const asNum = parseInt(trimmed, 10)
    return FUEL_RECIPIENTS.filter(r => r.truckNumber === asNum)
  }

  // Driver code (case-insensitive)
  const upper = trimmed.toUpperCase()
  return FUEL_RECIPIENTS.filter(r => r.driverCode && r.driverCode.toUpperCase() === upper)
}

/** Time-of-day greeting based on Salt Lake City time. */
export function getTimeOfDayGreeting(tz: string = 'America/Denver'): string {
  const hourStr = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date())
  const hour = parseInt(hourStr, 10)
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** Today's date formatted like "April 23, 2026". */
export function getTodaysDateFormatted(tz: string = 'America/Denver'): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())
}
