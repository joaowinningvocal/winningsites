/* Documents people sign online.
   The legal text lives in public/docs/<id>.html (converted from the ranch's
   Word files, wording unchanged); the original is offered as <id>.pdf.
   `sections` mirror the blanks in each Word file, so the online form asks for the
   same information the paper version does. */

const STATES_HINT = 'NV';

const person = (title, { address = true } = {}) => ({
  id: 'person', title,
  fields: [
    { key: 'name', label: 'Full legal name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true, w: 'half' },
    { key: 'cell', label: 'Cell phone', type: 'tel', required: true, w: 'half' },
    ...(address ? [
      { key: 'homePhone', label: 'Home or work phone', type: 'tel', w: 'half' },
      { key: 'street', label: 'Street address', type: 'text', required: true, w: 'half' },
      { key: 'city', label: 'City', type: 'text', required: true, w: 'third' },
      { key: 'state', label: 'State', type: 'text', required: true, w: 'third', placeholder: STATES_HINT },
      { key: 'zip', label: 'ZIP', type: 'text', required: true, w: 'third' },
    ] : []),
  ],
});

const emergency = {
  id: 'emergency', title: 'Emergency contacts',
  fields: [
    { key: 'em1Name', label: 'Contact 1, name', type: 'text', required: true, w: 'third' },
    { key: 'em1Relationship', label: 'Relationship', type: 'text', required: true, w: 'third' },
    { key: 'em1Phone', label: 'Phone', type: 'tel', required: true, w: 'third' },
    { key: 'em2Name', label: 'Contact 2, name', type: 'text', w: 'third' },
    { key: 'em2Relationship', label: 'Relationship', type: 'text', w: 'third' },
    { key: 'em2Phone', label: 'Phone', type: 'tel', w: 'third' },
  ],
};

const medical = {
  id: 'medical', title: 'Medical contacts', optional: true,
  fields: [
    { key: 'doctorName', label: 'Doctor', type: 'text', w: 'half' },
    { key: 'doctorPhone', label: 'Doctor’s phone', type: 'tel', w: 'half' },
    { key: 'dentistName', label: 'Dentist', type: 'text', w: 'half' },
    { key: 'dentistPhone', label: 'Dentist’s phone', type: 'tel', w: 'half' },
  ],
};

// The photo and video permission at the end of the riding forms
const photoSection = (whose) => ({
  id: 'photo', title: 'Photos and video',
  fields: [{ key: 'photo', label: `May Winning Ranch use ${whose} in its promotional or educational materials? This doesn’t affect participation.`, type: 'choice', options: ['I consent', 'I do not consent'], required: true }],
});

// The "Instructor & insurance information" block of the riding forms. The office fills it in once
// (dashboard → Waivers); each signature keeps a copy of it as it was that day.
const INSTRUCTOR_FIELDS = [
  { key: 'iName', label: 'Instructor name' },
  { key: 'iBusiness', label: 'Business name (if any)' },
  { key: 'iPhone', label: 'Instructor phone' },
  { key: 'iEmail', label: 'Instructor email' },
  { key: 'iCarrier', label: 'Insurance carrier' },
  { key: 'iPolicy', label: 'Policy no.' },
  { key: 'iPeriod', label: 'Policy period' },
  { key: 'iLimits', label: 'Coverage limits' },
  { key: 'iConfirmed', label: 'Equine professional liability coverage confirmed', options: ['Yes', 'No'] },
];
const INSTRUCTOR_DEFAULTS = { iName: 'Shelby Graham' };

// Blanks that are check boxes on paper: the chosen one is marked
const CHECKBOXES = { iConfirmed: ['Yes', 'No'], photo: ['I consent', 'I do not consent'] };

const DOCS = [
  {
    id: 'boarding', title: 'Boarding agreement', group: 'Boarding', minutes: 10,
    who: 'Owners boarding a horse with us, monthly or for an event. Fill out one for each horse.',
    minor: { label: 'The owner is under 18', who: 'owner' },
    sections: [
      person('Owner'),
      {
        id: 'horse', title: 'Horse', fields: [
          { key: 'horseName', label: 'Horse’s name and registration number', type: 'text', required: true },
          { key: 'foaled', label: 'Foaled (year)', type: 'text', w: 'third' },
          { key: 'color', label: 'Color', type: 'text', w: 'third' },
          { key: 'markings', label: 'Markings', type: 'text', w: 'third' },
          { key: 'arrival', label: 'Arrival date', type: 'date', required: true, w: 'half' },
          { key: 'dangerous', label: 'Any dangerous habits? Describe, or leave empty', type: 'textarea' },
        ],
      },
      {
        id: 'health', title: 'Health history', fields: [
          { key: 'colic', label: 'Colic, how often', type: 'text', w: 'half' },
          { key: 'founder', label: 'Founder, when', type: 'text', w: 'half' },
          { key: 'allergies', label: 'Known allergies', type: 'text', w: 'half' },
          { key: 'healthOther', label: 'Other', type: 'text', w: 'half' },
          { key: 'tetanus', label: 'Tetanus toxoid, date', type: 'date', w: 'third' },
          { key: 'vee', label: 'VEE, date', type: 'date', w: 'third' },
          { key: 'encephalo', label: 'Encephalomyelitis (E & W), date', type: 'date', w: 'third' },
          { key: 'worming', label: 'Last worming', type: 'date', w: 'half' },
          { key: 'coggins', label: 'Coggins test, date', type: 'date', required: true, w: 'half' },
        ],
      },
      {
        id: 'feeding', title: 'Feeding and care', fields: [
          { key: 'hay', label: 'Hay type and amount', type: 'text', w: 'half' },
          { key: 'grain', label: 'Grain type(s) and amount', type: 'text', w: 'half' },
          { key: 'pellets', label: 'Pellets, amount', type: 'text', w: 'half' },
          { key: 'feedAllergies', label: 'Feed allergies', type: 'text', w: 'half' },
          { key: 'specialCare', label: 'Special care requirements', type: 'textarea' },
          { key: 'habits', label: 'Habits', type: 'textarea' },
        ],
      },
      {
        id: 'mare', title: 'Mares only', optional: true, collapsed: true, fields: [
          { key: 'foalAtSide', label: 'Foal at side?', type: 'text', w: 'half' },
          { key: 'sireOfFoal', label: 'Sire of foal', type: 'text', w: 'half' },
          { key: 'lastFoaling', label: 'Date of last foaling', type: 'date', w: 'half' },
          { key: 'stallion', label: 'Stallion to which the mare shall be bred', type: 'text', w: 'half' },
        ],
      },
      {
        id: 'contacts', title: 'Contacts for the horse', fields: [
          { key: 'emName', label: 'Emergency contact if we can’t reach you', type: 'text', required: true, w: 'half' },
          { key: 'emPhone', label: 'Their phone', type: 'tel', required: true, w: 'half' },
          { key: 'vetName', label: 'Veterinarian for emergencies', type: 'text', w: 'half' },
          { key: 'vetPhone', label: 'Vet’s phone', type: 'tel', w: 'half' },
          { key: 'insured', label: 'Is the horse insured?', type: 'choice', options: ['Yes', 'No'], required: true },
          { key: 'insCarrier', label: 'Insurance carrier', type: 'text', w: 'half', showIf: ['insured', 'Yes'] },
          { key: 'insPolicy', label: 'Policy number', type: 'text', w: 'half', showIf: ['insured', 'Yes'] },
          { key: 'insAddress', label: 'Carrier’s address', type: 'text', showIf: ['insured', 'Yes'] },
          { key: 'insContact', label: 'Insurance contact for emergencies, with phone', type: 'text', showIf: ['insured', 'Yes'] },
        ],
      },
      {
        id: 'surgical', title: 'Surgery decision', fields: [
          { key: 'surgical', label: 'This horse is or is not considered a surgical candidate in the event of colic or serious illness', type: 'choice', options: ['IS a surgical candidate', 'IS NOT a surgical candidate'], required: true },
          { key: 'surgicalInitials', label: 'Owner’s initials', type: 'text', required: true, w: 'third', max: 6 },
        ],
      },
      { ...emergency, title: 'Your emergency contacts' },
      medical,
    ],
  },
  // The riding forms from Nov 2026. The office fills in the instructor and insurance block once (instructor: true);
  // the minor consent is always filled out and signed by a parent or guardian (signedByGuardian).
  {
    id: 'participant', title: 'Adult participant waiver', group: 'Riding', minutes: 5, instructor: true,
    who: 'Adults 18 and over taking lessons, riding or handling horses at the ranch.',
    minor: null,
    sections: [
      {
        id: 'person', title: 'Participant',
        fields: [
          { key: 'name', label: 'Full legal name', type: 'text', required: true },
          { key: 'dob', label: 'Date of birth', type: 'date', required: true, w: 'half' },
          { key: 'cell', label: 'Phone', type: 'tel', required: true, w: 'half' },
          { key: 'email', label: 'Email', type: 'email', required: true },
          { key: 'street', label: 'Street address', type: 'text', required: true },
          { key: 'city', label: 'City', type: 'text', required: true, w: 'third' },
          { key: 'state', label: 'State', type: 'text', required: true, w: 'third', placeholder: STATES_HINT },
          { key: 'zip', label: 'ZIP', type: 'text', required: true, w: 'third' },
        ],
      },
      {
        id: 'emergency', title: 'Emergency contact', fields: [
          { key: 'emName', label: 'Name', type: 'text', required: true, w: 'half' },
          { key: 'emPhone', label: 'Phone', type: 'tel', required: true, w: 'half' },
        ],
      },
      photoSection('my image or likeness'),
    ],
  },
  {
    id: 'minor', title: 'Minor participant consent', group: 'Riding', minutes: 5, instructor: true, signedByGuardian: true,
    who: 'For riders under 18. A parent or legal guardian fills it out and signs.',
    minor: null,
    sections: [
      {
        id: 'child', title: 'Minor participant',
        fields: [
          { key: 'name', label: 'Minor’s full name', type: 'text', required: true },
          { key: 'dob', label: 'Date of birth', type: 'date', required: true, w: 'half' },
          { key: 'age', label: 'Age', type: 'text', required: true, w: 'half', max: 3 },
        ],
      },
      {
        id: 'guardian', title: 'Parent or legal guardian',
        fields: [
          { key: 'guardianName', label: 'Parent or guardian’s full legal name', type: 'text', required: true, w: 'half' },
          { key: 'relationship', label: 'Relationship to the minor', type: 'text', required: true, w: 'half' },
          { key: 'email', label: 'Email', type: 'email', required: true, w: 'half' },
          { key: 'cell', label: 'Phone', type: 'tel', required: true, w: 'half' },
          { key: 'street', label: 'Street address', type: 'text', required: true },
          { key: 'city', label: 'City', type: 'text', required: true, w: 'third' },
          { key: 'state', label: 'State', type: 'text', required: true, w: 'third', placeholder: STATES_HINT },
          { key: 'zip', label: 'ZIP', type: 'text', required: true, w: 'third' },
          { key: 'legalAuthority', label: 'Legal authority, if you are not a parent', type: 'text' },
          { key: 'guardian2Name', label: 'Second parent or guardian’s name', type: 'text' },
        ],
      },
      {
        id: 'emergency', title: 'Emergency contact, if different', optional: true, fields: [
          { key: 'emName', label: 'Name', type: 'text', w: 'half' },
          { key: 'emPhone', label: 'Phone', type: 'tel', w: 'half' },
        ],
      },
      photoSection('the minor’s image or likeness'),
    ],
  },
  // The riding forms used until Nov 2026. Kept so their signed copies and old links still work; not offered anymore.
  {
    id: 'lesson', title: 'Adult lesson packet', group: 'Riding', step: 1, minutes: 5, retired: true,
    who: 'Anyone riding a boarded horse or taking lessons. Sign this first.',
    minor: { label: 'The rider is under 18', who: 'rider' },
    sections: [person('Rider'), emergency, medical],
  },
  {
    id: 'liability', title: 'Adult liability waiver', group: 'Riding', step: 2, minutes: 3, retired: true,
    who: 'Anyone riding a boarded horse or taking lessons. Sign this second.',
    minor: { label: 'The rider is under 18', who: 'rider' },
    sections: [person('Rider', { address: false })],
  },
  {
    id: 'employee', title: 'Employee packet', group: 'Employment', minutes: 5,
    who: 'New members of the ranch team, before the first day.',
    minor: null,
    sections: [person('You'), emergency, medical],
  },
];

const docById = (id) => DOCS.find((d) => d.id === id);
const allFields = (doc) => doc.sections.flatMap((s) => s.fields.map((f) => ({ ...f, section: s.id })));

// What the blanks marked <span class="blank" data-fill="key"> are filled with: the form's fields,
// plus the address put together and the signing date. public/js/sign.js does the same while typing.
const fillValues = (fields, signedAt) => {
  const f = fields || {};
  const cityStateZip = [f.city, [f.state, f.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const boxes = {};
  // Dates a person types (date of birth) read the way they would on paper: 04/12/1990
  for (const k of ['dob']) if (/^\d{4}-\d{2}-\d{2}$/.test(f[k] || '')) { const [y, m, d] = f[k].split('-'); boxes[k] = `${m}/${d}/${y}`; }
  for (const [k, opts] of Object.entries(CHECKBOXES)) if (f[k]) boxes[k] = opts.map((o) => `${o === f[k] ? '☒' : '☐'} ${o}`).join('   ');
  return {
    ...f, ...boxes, cityStateZip,
    fullAddress: [f.street, cityStateZip].filter(Boolean).join(', '),
    date: signedAt ? new Date(signedAt).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' }) : '',
  };
};
// The form fields each combined blank stands for
const FILL_PARTS = { fullAddress: ['street', 'city', 'state', 'zip'], cityStateZip: ['city', 'state', 'zip'] };

module.exports = { DOCS, docById, allFields, fillValues, FILL_PARTS, CHECKBOXES, INSTRUCTOR_FIELDS, INSTRUCTOR_DEFAULTS };
