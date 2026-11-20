// The career's story: a coach, a rival and, once you turn pro, an agent.
//
// Career logic (career.js) leaves a list of what just happened in
// c.story.pendingEvents; storyAfter() turns it into cards in c.story.queue. A card is
// { speaker, text } and may offer choices; a choice can change how the characters
// see you (the coach's trust, the rivalry's heat, your stated ambition), and later
// lines depend on that. All characters are invented.
import { rankOf, playerById, TIERS } from './career.js';

export const CAST = {
  coach: { name: 'COACH HALVIK', color: '#2f9e58' },
  rival: { name: 'RIVAL', color: '#b3261e' },
  agent: { name: 'DEV ANNARO, AGENT', color: '#e0b65a' },
  news: { name: 'NEWS', color: '#3f5d8a' },
  you: { name: 'YOU', color: '#d8f23a' },
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const fill = (c, text) => text
  .replace(/\{you\}/g, c.you.name)
  .replace(/\{rival\}/g, rivalName(c))
  .replace(/\{age\}/g, String(c.you.age));
const rivalName = (c) => { const r = playerById(c, c.story.rival); return r ? r.name : 'your rival'; };

function say(c, speaker, text, choices = null) {
  c.story.queue.push({ speaker, text: fill(c, Array.isArray(text) ? pick(text) : text), choices });
}
function once(c, key) {
  if (c.story.flags[key]) return false;
  c.story.flags[key] = true;
  return true;
}

// ---------------------------------------------------------------- the opening
export function storyIntro(c) {
  say(c, 'news', 'You are fourteen. You have a racket, a bag of old balls and a place at the Halvik Academy in Willowmere.');
  say(c, 'coach', "So you're {you}. I'm Rosa Halvik. I played on the tour for eleven years, and I've coached kids for twenty. I don't care how good you are today. I care how good you want to be.");
  say(c, 'coach', 'So tell me. What do you want from this?', [
    { label: 'To be world number one.', set: { ambition: 'top' }, reply: ['coach', "Good. Say it out loud every morning. Then go and earn it, one boring drill at a time."] },
    { label: 'To enjoy every match I play.', set: { ambition: 'joy' }, reply: ['coach', "That's rarer than you think. Players who love the game last longest. Hold on to that."] },
    { label: 'To prove the doubters wrong.', set: { ambition: 'prove' }, reply: ['coach', "Fire is useful. Just make sure it burns for you, not at you."] },
  ]);
  say(c, 'news', 'On the next court, a kid in a white cap stops hitting and watches you warm up.');
  say(c, 'rival', "{rival}. Junior number one in this academy, and soon everywhere else. You're the new one? Try to keep up.", [
    { label: '"We\'ll see about that on court."', heat: 1, reply: ['rival', 'Ha. I like that. I\'ll enjoy beating you.'] },
    { label: '"Nice to meet you. Good luck this season."', heat: -1, reply: ['rival', '...Right. You too, I suppose.'] },
    { label: 'Say nothing and keep hitting.', reply: ['rival', 'Quiet type. Fine. The scoreboard will do the talking.'] },
  ]);
  say(c, 'coach', "Start with the Junior Club Series. Small events, no pressure, lots of matches. Win enough of them and the bigger juniors open up. Now go.");
}

// ---------------------------------------------------------------- after each action
const JR_MILESTONES = [50, 20, 10, 3, 1], PRO_MILESTONES = [100, 50, 20, 10, 5, 1];

export function storyAfter(c) {
  const evs = c.story.pendingEvents || [];
  c.story.pendingEvents = [];
  const s = c.story;
  for (const e of evs) {
    switch (e.type) {
      case 'enter': onEnter(c, e); break;
      case 'won':
        s.streak = Math.max(0, s.streak || 0) + 1;
        if (once(c, 'firstWin')) say(c, 'coach', ['Your first match win. Remember how that felt. You will need that feeling on the hard days.', 'There it is. Your first win. Enjoy it tonight, then forget it tomorrow.']);
        else if (e.oppRank && (e.oppRank <= 5 || (rankOf(c, 0) && e.oppRank * 4 < rankOf(c, 0)))) {
          say(c, 'news', `Upset! {you} beats ${e.opp}, ranked ${e.oppRank}.`);
          if (Math.random() < 0.6) say(c, 'coach', ["That's the win people will remember. I'll remember the footwork in the third game.", 'You played the ball, not the ranking. Good.']);
        } else if (s.streak === 5) say(c, 'coach', 'Five wins in a row. Keep your routines exactly the same. Superstition is just discipline with a story.');
        break;
      case 'lost':
        s.streak = Math.min(0, s.streak || 0) - 1;
        if (once(c, 'firstLoss')) say(c, 'coach', ["You'll lose more matches than you win for a while. Everyone does. What matters is what you take from them.", 'First loss. Shake hands, pack your bag, and tell me one thing you would do differently.']);
        else if (s.streak === -3) {
          say(c, 'coach', "Three losses in a row. Talk to me. What's going on?", [
            { label: '"I\'m tired. I need a break."', set: { rested: true }, reply: ['coach', 'Then take one. Rest a week, sleep, eat properly. A tired player learns nothing.'] },
            { label: '"I just need to work harder."', trust: 1, reply: ['coach', "Harder, and smarter. Extra serves tomorrow at seven. I'll be there."] },
            { label: '"Maybe I\'m not good enough."', trust: -1, reply: ['coach', "Stop that right now. I don't waste my time on players who aren't good enough. Back on court."] },
          ]);
        }
        break;
      case 'beatRival': {
        const { w, l } = s.h2h;
        if (w === 1) say(c, 'rival', s.heat > 0 ? ['Enjoy it. It will not happen again.', 'Lucky. Everyone gets one lucky day.'] : ['Well played. Really. Next time is mine, though.']);
        else if (w > l + 2) say(c, 'rival', s.heat > 0 ? "Again? I'm going to stop answering your messages. Oh wait, I never did." : "You've got my number lately. I'm working on it, believe me.");
        else say(c, 'rival', s.heat > 0 ? ['Fine. Your day. Mine next.', "Don't get used to it."] : ['Good match. You earned that one.']);
        say(c, 'news', `Head-to-head: {you} ${w}, {rival} ${l}.`);
        break;
      }
      case 'lostRival':
        say(c, 'rival', s.heat > 0 ? ['Told you. Keep up.', 'Same result as always.', 'Was that your best? Honestly asking.'] : ['Good fight. You pushed me today.', "That was closer than the score says."]);
        if (s.heat > 1 && once(c, 'rivalTalk')) {
          say(c, 'coach', '{rival} gets under your skin. I can see it in your shoulders. What do you want to do about it?', [
            { label: '"Beat them. Every single time."', heat: 1, reply: ['coach', "Then do it with your racket, not your face. Use it, don't wear it."] },
            { label: '"Ignore them. Focus on my game."', heat: -1, trust: 1, reply: ['coach', "That's the grown-up answer. And the winning one."] },
          ]);
        }
        break;
      case 'title': onTitle(c, e); break;
      case 'bestRank': onRank(c, e); break;
      case 'seasonEnd': onSeasonEnd(c, e); break;
      case 'birthday': onBirthday(c, e); break;
      case 'decision': onDecision(c, e); break;
      case 'turnedPro': onTurnedPro(c, e); break;
      case 'retired': onRetired(c, e); break;
      case 'rest':
        if (Math.random() < 0.25) say(c, 'coach', ['A week off is part of the plan, not a break from it.', 'Rest week. Legs up, phone down.']);
        break;
      default:
    }
  }
}

function onEnter(c, e) {
  const d = c.current && c.current.draw;
  if (once(c, `enter-${e.tier}`)) {
    const lines = {
      jOpen: 'A Junior Open. Bigger draw, better players, scouts in the stands. Breathe.',
      jCrown: "A Junior Crown. Stadium court, a real crowd, cameras. It's the same lines and the same net. Play the ball.",
      circuit: "The Circuit. Small crowds, long drives, no glamour. Every pro you've ever watched started somewhere like this.",
      contender: 'The Contender Series. These players are one good month away from the Tour, and they know it. So are you.',
      tour: "Your first Tour event. Look around in the locker room, then stop looking. You belong here.",
      crown: c.story.flags.ambition === 'top' ? 'A Crown. You told me at fourteen you wanted to be number one. This is where that gets decided.' : 'A Crown. The biggest stage there is. Enjoy every second of it, then win it.',
    }[e.tier];
    if (lines) say(c, 'coach', lines);
  }
  if (d && d.entrants.includes(c.story.rival) && Math.random() < 0.7) {
    say(c, 'rival', c.story.heat > 0
      ? ["Saw your name in the draw. Hope you packed for a short trip.", "Same draw again. Don't lose before you get to me.", "Big event. Try not to embarrass yourself."]
      : ['Saw we\'re in the same draw. See you in the final?', 'Good luck this week. Mostly.']);
  }
}

function onTitle(c, e) {
  const T = TIERS[e.tier];
  if (e.count === 1) {
    say(c, 'news', `{you} wins a first title at the ${e.name}!`);
    say(c, 'coach', {
      top: "Your first title. Number one is still a long way off, but today you're number one in this town. Enjoy it.",
      joy: 'Your first title! Did you enjoy it? You looked like you did. That is the whole point.',
      prove: 'Your first title. How many doubters do you think are left? Fewer than yesterday.',
    }[c.story.flags.ambition] || 'Your first title. Frame the draw sheet.');
    return;
  }
  if (once(c, `title-${e.tier}`)) {
    if (e.tier === 'crown') {
      say(c, 'news', `{you} is a Crown champion! The ${e.name} is theirs.`);
      say(c, 'coach', "I've been waiting a long time to say this. Crown champion. I'm proud of you. Now go and find your family, they're crying more than I am.");
      say(c, 'rival', c.story.heat > 1 ? 'Congratulations. I mean it, even if it hurts to type.' : 'A Crown! You deserve it. Drinks are on you.');
    } else if (e.tier === 'jCrown') {
      say(c, 'news', `{you} wins the ${e.name}, a junior Crown.`);
      say(c, 'coach', 'A junior Crown. People will start talking about you now. Let them talk. You keep working.');
    } else {
      say(c, 'coach', `Your first ${T.label} title. That's a level done. Next one up.`);
    }
  } else if (e.tier === 'crown') {
    say(c, 'news', `{you} wins the ${e.name}. That's another Crown.`);
  } else if (Math.random() < 0.4) {
    say(c, 'coach', ['Another title. Same routine tomorrow.', 'Good week. Trophy in the bag, eyes on the next draw.']);
  }
}

function onRank(c, e) {
  const list = e.stage === 'junior' ? JR_MILESTONES : PRO_MILESTONES;
  const m = [...list].reverse().find((x) => e.rank <= x);
  if (!m || !once(c, `rank-${e.stage}-${m}`)) return;
  const tour = e.stage === 'junior' ? 'junior' : 'world';
  if (m === 1) {
    say(c, 'news', `{you} is the new ${tour} number one!`);
    if (e.stage === 'pro') {
      say(c, 'coach', c.story.flags.ambition === 'top'
        ? "A fourteen-year-old once told me 'world number one'. I didn't laugh. I'm glad I didn't."
        : 'World number one. Nobody can ever take that away from you. Not even the next person who gets there.');
      say(c, 'rival', c.story.heat > 1 ? 'Enjoy the view. I am coming for it.' : 'Number one. You earned it. Now I have to work even harder.');
    } else say(c, 'coach', 'Junior number one. Lovely. It means nothing on the pro tour, and everything for your confidence.');
  } else {
    say(c, 'news', `{you} climbs into the ${tour} top ${m}.`);
    if (Math.random() < 0.5) say(c, 'coach', [`Top ${m}. Write it down, then set the next number.`, `Top ${m}. Good. Don't read the rankings every morning, though.`]);
  }
}

function onSeasonEnd(c, e) {
  const where = e.rank ? `number ${e.rank}` : 'unranked';
  const tour = e.stage === 'junior' ? 'junior' : 'world';
  say(c, 'news', `Season ${e.season} is over. {you} finishes ${where} in the ${tour} rankings.`);
  const r = playerById(c, c.story.rival);
  const rr = r && !r.retired ? rankOf(c, r.id, e.stage) : null;
  if (rr && e.rank) say(c, 'news', rr < e.rank ? `{rival} ends the season ${rr === 1 ? 'on top' : `at number ${rr}`}, ${e.rank - rr} places ahead of you.` : `You finish ahead of {rival}, who ends at number ${rr}.`);
  const t = c.story.trust;
  say(c, 'coach', e.rank && e.rank <= 10
    ? ['A season to be proud of. Take two weeks off. Then we go again.', "Top ten. I'll allow one day of celebrating."]
    : t >= 2 ? ["We're building something, you and me. Next season the work starts to show."] : ['Season done. We learn from it, we rest, and we come back sharper.']);
}

function onBirthday(c, e) {
  const lines = {
    15: 'Fifteen. Happy birthday. Your present is a new fitness programme.',
    16: "Sixteen. Some players turn pro at your age. Most shouldn't. We'll talk about it when you're ready.",
    17: 'Seventeen. Big year. At eighteen you choose: college or the pro tour. Play well and you get to choose freely.',
    21: 'Twenty-one. Happy birthday. You are not a prospect any more, you are a player.',
    25: 'Twenty-five. The best years start now, if you look after your body.',
    30: "Thirty. Don't let anyone tell you it's over. It's just different now.",
    33: 'Thirty-three. Every season from here is a gift. Enjoy them.',
  };
  if (lines[e.age]) say(c, 'coach', lines[e.age]);
}

function onDecision(c, e) {
  say(c, 'news', `{you} is eighteen and finishes as junior number ${e.juniorRank || 'unranked'}. The offers are coming in.`);
  say(c, 'coach', e.juniorRank && e.juniorRank <= 10
    ? 'You can turn pro with wildcards waiting for you, or take a scholarship and keep developing at college. Both are good roads. Which suits you?'
    : 'Turning pro now means starting at the very bottom. College gives you time to grow. There is no wrong answer, only your answer.');
  say(c, 'agent', "Dev Annaro, sports agent. I've watched your juniors. If you turn pro, I can get you into the right events. Think about it.");
}

function onTurnedPro(c, e) {
  c.story.flags.agent = true;
  say(c, 'news', `It's official: {you} turns pro at ${c.you.age}.`);
  if (c.you.age < 18) {
    say(c, 'coach', 'You want to go early. I think it is too soon, and I have told you why. But it is your career. I will be in your box either way.');
    c.story.trust -= 1;
  } else say(c, 'coach', 'Welcome to the hardest job in sport. Start on the Circuit, win matches, and the bigger events will open up.');
  say(c, 'agent', e.wildcards
    ? `Good news: your junior record got us ${e.wildcards} wildcard${e.wildcards > 1 ? 's' : ''}. Use them on events above your ranking when you feel ready.`
    : "No wildcards yet, so we earn our way in. The Circuit is where reputations start.");
  say(c, 'rival', c.story.heat > 0 ? 'So you made it to the pros. Took you long enough. The real tour starts now.' : 'Pros now, both of us. Strange, right? See you out there.');
}

function onRetired(c) {
  const titles = c.you.titles.length, crowns = c.you.titles.filter((t) => t.tier === 'crown').length;
  say(c, 'news', `{you} retires at ${c.you.age} with ${titles} title${titles === 1 ? '' : 's'}${crowns ? `, ${crowns} of them Crowns` : ''}.`);
  say(c, 'coach', 'Fourteen years old with a bag of old balls. Look at you now. Thank you for letting me be part of it.');
  const { w, l } = c.story.h2h;
  say(c, 'rival', c.story.heat > 1
    ? `We never really liked each other, did we? ${w}-${l}. Still, nobody made me better than you did.`
    : `${w}-${l} in our matches, and a friendship I didn't expect. Thank you for everything, {you}.`);
}

// Apply a choice on the card at the front of the queue.
export function choose(c, index) {
  const card = c.story.queue.shift();
  const ch = card && card.choices && card.choices[index];
  if (!ch) return;
  if (ch.set) Object.assign(c.story.flags, ch.set);
  if (ch.heat) c.story.heat += ch.heat;
  if (ch.trust) c.story.trust += ch.trust;
  c.story.queue.unshift({ speaker: 'you', text: ch.label.replace(/^"|"$/g, '') });
  if (ch.reply) c.story.queue.splice(1, 0, { speaker: ch.reply[0], text: fill(c, Array.isArray(ch.reply[1]) ? pick(ch.reply[1]) : ch.reply[1]) });
}
export function dismiss(c) { c.story.queue.shift(); }
export const speakerName = (c, card) => (card.speaker === 'rival' ? rivalName(c) : CAST[card.speaker].name);
