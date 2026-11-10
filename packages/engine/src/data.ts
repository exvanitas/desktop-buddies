/* The tables the world runs on: default lines, chat rates. */
import type { Situation } from '@buddies/buddy-file';

export const LINES: Record<Situation | 'sleep', string[]> = {
  hello: ['Hi!', 'You called?', 'Hm?', 'Here I am!', 'Yes?'],
  love: ['Yay!', 'Hehe', 'Best day ever', 'More pats please', 'So happy!'],
  cry: ['Waaah…', 'Sniff…', 'Play with me…', 'So lonely…'],
  hurt: ['Ouch!', 'Owie…', 'Be gentle!', 'Everything is spinning…'],
  wake: ['Mm…?', 'Good nap!', 'Is it morning?', 'I was awake! Totally.'],
  climb: ['Up I go!', 'Hup, hup', 'So high!'],
  drop: ['Wheee!', 'Whoa!', 'Look out below!'],
  held: ['Put me down!', 'Where are we going?', 'Wow, the view!'],
  comfort: ['Thank you…', 'I feel better', 'Hehe, thanks'],
  grab: ['Got it!', 'Phew!', 'Safe!'],
  sleep: ['So sleepy…', 'Just a quick nap', 'Zzz…'],
  dance: ["Let's dance!", 'Groovy!', 'Dance party!', 'Bust a move~'],
  sing: ['La la la~', 'Hmm hm hmm~', 'Sing along!'],
  yawn: ['*yaaawn*', 'Getting sleepy…'],
  shy: ['W-what?', "Don't stare…", 'Hehe…', "You're making me blush"],
  angry: ['Stop poking me!', 'Hmph!', 'Enough!', "I'm not a button!"],
  chase: ['Wait up!', "I'll catch you!", 'Come back!'],
  caught: ['Gotcha!', 'I win!'],
  eat: ['Nom nom', 'Yummy!', 'Snack time!', 'Delicious'],
  think: ["What's for dinner?", 'I want to see clouds', 'What should we play?', 'Hungry…', 'Hmm…'],
  trip: ['Oops!', 'I tripped…'],
  getup: ["I'm okay!", 'Hup!', "Didn't hurt!"],
  chat: ["You're doing great!", 'Whatcha doing?', "I'm right here", "Let's play!", 'Take a break sometimes', 'Drink some water!', 'Have a nice day!', 'Bored…', 'Working hard, huh?'],
  spin: ['Round and round~', 'Dizzy…'],
  roll: ['Rolly polly~', 'Here I go~'],
  bye: ['Bye bye!', 'See you later!', 'Off I go!', 'Call me anytime!'],
  greet: ['Hello, friend!', "Oh, it's you!", 'Wanna play?', 'Hiya!'],
  hug: ['Hug!', 'Love you!', 'So warm'],
  bump: ['Sorry!', 'You okay?'],
  bumped: ['Ow…', 'Hey!'],
  tired: ['Phew…', 'Too fast…', 'I give up!'],
  full: ['That hit the spot!', 'So full…', '*burp* Oops'],
  grumpy: ['Hmph!', 'Still mad.', 'Not talking to you.'],
  dragme: ['Try dragging me!', 'Pick me up!']
};

export const GOODBYE_MS = 900; /* how long a dismissed buddy stays to say so */

/* how often a calm buddy talks, in frames */
export const CHAT = { off: Infinity, low: 2600, normal: 1200, high: 480 };
