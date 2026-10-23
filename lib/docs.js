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
  {
    id: 'lesson', title: 'Adult lesson packet', group: 'Riding', step: 1, minutes: 5,
    who: 'Anyone riding a boarded horse or taking lessons. Sign this first.',
    minor: { label: 'The rider is under 18', who: 'rider' },
    sections: [person('Rider'), emergency, medical],
  },
  {
    id: 'liability', title: 'Adult liability waiver', group: 'Riding', step: 2, minutes: 3,
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

module.exports = { DOCS, docById, allFields };
