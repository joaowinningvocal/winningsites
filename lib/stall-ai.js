/* The stall assistant on the Stall board. Jenna writes something like
   "I have 5 horses coming in Nov 15 - Nov 17, what stalls can I put them in?"
   and Claude books the stalls through the same tools the board uses (routes/board.js),
   so every rule (pony-only stall, closeness, conflicts) is enforced in code, not by the model.
   Needs ANTHROPIC_API_KEY on Railway; without it the board shows the quick form instead. */
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5-5';
const MAX_TURNS = 8;

const SYSTEM = `You help the Winning Ranch office book stalls. You act through tools; the tools enforce every rule and pick the stalls.

The barn: stalls 1-10 on the right side (1 at the bottom) and 11-20 on the left side (11 at the bottom), so stall n faces stall n+10 across the aisle. Stall 1 is not in use. Stall 10 is for ponies only. Stall 20 is shorter (12' x 22'). There are also 8 outdoor stalls (ids O1-O8) in a row along the drive, far from the barn. Barn stall ids are M1-M20.

Stalls marked "ours" hold the ranch's own horses. Those horses can move to the ranch's other property to free the stall, so the tools can book over them; when a booking does, say which stalls have one of our horses to move.

How to handle requests:
- Horses that arrive together are bonded and must stay close: always use find_stalls to choose, and book its first option unless the person asked for something else. If several groups arrive (say 3 from one owner and 2 from another), find and book each group separately so each stays together.
- Nightly stays: "from" is the arrival day and "to" the departure day ("Nov 15 - Nov 17" means arrive Nov 15, leave Nov 17). Monthly boarders use kind "monthly" with no "to" unless an end date is given.
- Dates without a year are the next time that date comes up after today.
- When you know how many horses and the dates, book right away; don't ask for confirmation, the office can undo it. Use horse names, owner name and phone if given, otherwise leave them out. If the dates or the number of horses are missing, ask.
- Mention ponies only when the person does, and pass them in "ponies".
- If there isn't room, say so and say what is free.
- To see what is booked or free on some dates, use look_up_stalls.

Reply in the person's language, short and plain (no tables, no markdown headings): which stalls, the dates, the booking ref, and anything the team has to do.`;

const TOOLS = [
  {
    name: 'look_up_stalls',
    description: 'Shows every stall for a date range: free, ours (one of the ranch horses, can move), taken (by whom, until when) or not in use.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First day, YYYY-MM-DD' },
        to: { type: 'string', description: 'Day after the last night, YYYY-MM-DD. Leave out to check one day.' },
      },
      required: ['from'],
    },
  },
  {
    name: 'find_stalls',
    description: 'Finds the best stalls for a group of bonded horses for the dates, closest together first. Does not book anything.',
    input_schema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 20, description: 'How many horses in the group' },
        ponies: { type: 'integer', minimum: 0, description: 'How many of them are ponies' },
        kind: { type: 'string', enum: ['nightly', 'monthly'] },
        from: { type: 'string', description: 'Arrival day, YYYY-MM-DD' },
        to: { type: 'string', description: 'Departure day, YYYY-MM-DD. Leave out for monthly boarders with no end date.' },
      },
      required: ['count', 'kind', 'from'],
    },
  },
  {
    name: 'book_stalls',
    description: 'Books stalls for one group. Give one horse per stall, in the same order as stall_ids (ponies in the pony-only stall).',
    input_schema: {
      type: 'object',
      properties: {
        stall_ids: { type: 'array', items: { type: 'string' }, description: 'Stall ids like M4 or O2' },
        horses: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, pony: { type: 'boolean' } } },
          description: 'One per stall, same order. Name can be empty.',
        },
        kind: { type: 'string', enum: ['nightly', 'monthly'] },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD; leave out for monthly boarders with no end date' },
        owner_name: { type: 'string' },
        phone: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['stall_ids', 'horses', 'kind', 'from'],
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancels a booking made on the Stall board (by its ref, like WR1042), for example to undo one you just made.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
  },
];

const configured = () => !!process.env.ANTHROPIC_API_KEY;

let client = null;
const getClient = () => (client = client || new Anthropic());

/* history: earlier turns of this conversation [{ role: 'user' | 'assistant', text }]
   tools: { look_up_stalls, find_stalls, book_stalls, cancel_booking } — each takes the input and returns a plain object
   Returns { reply, booked: [ref], cancelled: [ref] } */
async function ask({ message, history, today, tools }) {
  const messages = [];
  for (const h of history.slice(-12)) {
    if ((h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.trim()) messages.push({ role: h.role, content: h.text.slice(0, 4000) });
  }
  while (messages.length && messages[0].role !== 'user') messages.shift();
  messages.push({ role: 'user', content: `(Today is ${today} at the ranch.)\n\n${message}` });

  const booked = [], cancelled = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    if (res.stop_reason === 'refusal') return { reply: 'The assistant couldn’t help with that one. Try rewording it, or use the form.', booked, cancelled };
    messages.push({ role: 'assistant', content: res.content });
    const calls = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      const reply = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { reply: reply || 'Done.', booked, cancelled };
    }
    const results = [];
    for (const call of calls) {
      let out;
      try {
        const run = tools[call.name];
        out = run ? run(call.input || {}) : { error: 'Unknown tool.' };
      } catch (err) { out = { error: err.message }; }
      if (call.name === 'book_stalls' && out.ref) booked.push(out.ref);
      if (call.name === 'cancel_booking' && out.cancelled) cancelled.push(out.cancelled);
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out), ...(out.error ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'That took too many steps. Check the board and try a simpler request.', booked, cancelled };
}

module.exports = { ask, configured, APIError: Anthropic.APIError };
