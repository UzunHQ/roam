// Everything you are likely to change lives here.
export const config = {
  author: 'Hüseyin',
  links: {
    linkedin: 'https://www.linkedin.com/in/huseyinuzun-data', // empty hides the icon
  },
  // "Report a mistake" opens this Google Form with the place already filled in.
  // placeField is the form question's entry id (Forms → ⋮ → Get pre-filled link).
  reportForm: {
    url: 'https://docs.google.com/forms/d/e/1FAIpQLSeOFfC6bBmXhfqv7-nfP0jhJLkipsucAcGJOAQ4ZD324YF_2g/viewform',
    placeField: 'entry.820687780',
  },
  // Fallback when reportForm.url is empty: an inbox you read. Both empty hides the link.
  reportEmail: '',

  // Cookieless analytics (Umami). Leave websiteId empty to turn analytics off.
  // Umami Cloud: https://cloud.umami.is/script.js
  analytics: {
    umamiScript: 'https://cloud.umami.is/script.js',
    umamiWebsiteId: '',
  },

  walkingSpeedMps: 1.3, // ~4.7 km/h
  weakGpsM: 50,
};
