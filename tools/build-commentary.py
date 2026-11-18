"""Renders the match commentary into src/assets/commentary.js: every line in two
commentators' voices, as MP3 (base64), grouped by the moment it is for.

Same voice model as the line calls (see build-calls.py): Piper TTS with the
en-us-libritts-high model (trained on LibriTTS, CC BY 4.0). Needs ffmpeg.
  ./venv/bin/python tools/build-commentary.py path/to/en-us-libritts-high.onnx

The lines never use names (the player's is their own choice) or gendered words.
"""
import base64, json, subprocess, sys, tempfile, wave
from pathlib import Path
import numpy as np
from piper import PiperVoice, SynthesisConfig

MODEL = sys.argv[1]
VOICES = [272, 314]  # play-by-play and analyst, picked by pitch and liveliness (see the README)

LINES = {
    'matchStart': ["Here we go. The players are ready.", "Welcome along. This should be a good one.", "Let's get underway."],
    'ace': ["Ace!", "That's an ace.", "Unreturnable!", "Couldn't get a racket on that one.", "Right on the line. Ace."],
    'bigServe': ["What a serve.", "Big serve, that one."],
    'doubleFault': ["Double fault.", "Oh, a double fault. That's a gift.", "Two faults. The pressure showing there."],
    'winner': ["What a winner!", "Beautiful shot.", "Clean winner.", "Nothing anyone could do about that.", "Too good!", "That is a superb shot."],
    'volleyWinner': ["Lovely touch at the net.", "Put away at the net."],
    'smashWinner': ["Smashed away!", "Put away overhead."],
    'longRally': ["What a rally!", "Incredible rally. The crowd are loving this.", "That was a marathon of a point.", "What a point. Both players gave everything there."],
    'netError': ["Into the net.", "Caught the net there."],
    'longError': ["Just long.", "Long, by a whisker."],
    'wideError': ["Wide.", "Just wide."],
    'unforced': ["A loose one there.", "Should have made that.", "An unforced error. That will be frustrating."],
    'netCord': ["Off the net cord!", "A lucky bounce off the tape."],
    'dive': ["Full stretch!", "What an effort!", "Diving for it!"],
    'breakPoint': ["Break point.", "Break point here. A big moment.", "Here's a chance to break."],
    'break': ["And that's the break.", "Broken! A big swing in this set.", "Break of serve."],
    'deuce': ["Deuce.", "Back to deuce."],
    'matchPoint': ["Match point.", "Match point. Can it be closed out?"],
    'championshipPoint': ["Championship point!"],
    'matchWon': ["Game, set and match!", "And that's the match. What a performance."],
    'challenge': ["A challenge.", "Going to the review."],
    'overturned': ["The call is overturned!", "Good challenge."],
    'stands': ["The call stands.", "Wasted challenge, that one."],
    'tired': ["Looking tired now.", "The legs are starting to go."],
}

# ---- the booth: A is the play-by-play voice, B the analyst. Exchanges are short
# back-and-forths for a moment; pools are single lines the game strings together
# (the opening, score summaries). Each line is rendered in its speaker's voice only.
A, B = 0, 1
EXCHANGES = {
    'ace': [
        [(A, "Ace! What a delivery."), (B, "Unreturnable. When the serve is landing like that, there's very little the returner can do.")],
        [(A, "Another ace."), (B, "That's the kind of serve that wins you free points all day long.")],
        [(A, "Ace!"), (B, "Perfect placement. The returner barely moved."), (A, "Couldn't get a racket anywhere near it.")],
    ],
    'doubleFault': [
        [(A, "Double fault."), (B, "A costly one. You can see the frustration there.")],
        [(A, "Two faults."), (B, "The second serve looked a little tentative. Nerves, maybe.")],
    ],
    'winner': [
        [(A, "What a shot!"), (B, "Took it early, on the rise, and left no chance at all.")],
        [(A, "Winner!"), (B, "That's the reward for being aggressive. Great footwork to set it up.")],
        [(A, "Too good."), (B, "Sometimes you just have to applaud. Nothing anyone could do about that one.")],
        [(A, "Brilliant!"), (B, "Saw the gap and went straight for it. Fearless tennis."), (A, "The crowd loved that.")],
    ],
    'volleyWinner': [
        [(A, "Put away at the net."), (B, "Lovely hands. Came forward at exactly the right moment.")],
        [(A, "Lovely volley."), (B, "That's how you finish a point. Short and sharp.")],
    ],
    'smashWinner': [
        [(A, "Smashed away!"), (B, "Read the lob early and finished it in style.")],
    ],
    'longRally': [
        [(A, "What a rally!"), (B, "Incredible. Both players gave absolutely everything in that one."), (A, "And that's what this match is all about.")],
        [(A, "That was a marathon of a point."), (B, "Must have been well over a dozen shots. The legs will feel that later.")],
        [(A, "Wow. What a point."), (B, "Unbelievable defence, getting to ball after ball."), (A, "The crowd are on their feet.")],
    ],
    'netError': [
        [(A, "Into the net."), (B, "Rushed that one a little. Didn't quite get the feet set.")],
    ],
    'longError': [
        [(A, "Just long."), (B, "Going for a bit too much there. The margins are tiny.")],
    ],
    'wideError': [
        [(A, "Wide."), (B, "Trying to find the line, and missed by a whisker.")],
    ],
    'unforced': [
        [(A, "An unforced error."), (B, "That one will be frustrating. It was there to be put away.")],
    ],
    'netCord': [
        [(A, "Off the net cord!"), (B, "Sometimes you need a bit of luck. That's tennis.")],
    ],
    'dive': [
        [(A, "Diving for it!"), (B, "What commitment. Throwing everything into keeping that point alive.")],
        [(A, "Full stretch!"), (B, "Got there somehow. I'm honestly not sure how.")],
    ],
    'breakPoint': [
        [(A, "Break point."), (B, "Big moment here. The server needs this first serve in.")],
        [(A, "Here's a chance to break."), (B, "The returner will be looking to step in and attack the second serve.")],
    ],
    'break': [
        [(A, "And that's the break!"), (B, "A big moment in this set. The pressure finally told.")],
        [(A, "Broken!"), (B, "Wonderful returning in that game. Kept putting the ball deep, right at the feet.")],
    ],
    'breakSaved': [
        [(A, "Break point saved."), (B, "Played it with real courage. Didn't flinch.")],
        [(A, "Saved!"), (B, "That's what champions do on the big points.")],
    ],
    'deuce': [
        [(A, "Deuce."), (B, "This game is going on and on.")],
        [(A, "Back to deuce."), (B, "Neither player willing to give an inch.")],
    ],
    'matchPoint': [
        [(A, "Match point."), (B, "Deep breath now. One more point.")],
    ],
    'championshipPoint': [
        [(A, "Championship point!"), (B, "One point away from the title. Can the nerves hold?")],
    ],
    'matchWon': [
        [(A, "Game, set and match!"), (B, "What a performance. Thoroughly deserved, I thought."), (A, "And the crowd rise to their feet.")],
        [(A, "And that's the match!"), (B, "A fantastic contest from start to finish."), (A, "What a way to finish.")],
    ],
    'challenge': [
        [(A, "There's a challenge."), (B, "Looked close from up here. Let's have a look.")],
    ],
    'overturned': [
        [(A, "The call is overturned!"), (B, "Good challenge. Very sharp eyes.")],
    ],
    'stands': [
        [(A, "The call stands."), (B, "The line judge got it right after all. Worth a look, though.")],
    ],
    'tired': [
        [(A, "Looking tired now."), (B, "Those long rallies are taking their toll. The legs aren't moving as freely.")],
    ],
    'momentum': [
        [(A, "Three games in a row now."), (B, "The momentum has really swung. Everything is going right at the moment.")],
        [(A, "Another game on the run."), (B, "Riding a wave of confidence here.")],
    ],
    'filler': [
        [(A, "The crowd are really enjoying this."), (B, "It's a great atmosphere. A very knowledgeable tennis crowd here today.")],
        [(A, "Conditions are just about perfect."), (B, "Hardly any wind. Ideal for big hitting.")],
        [(A, "The server takes a moment."), (B, "Routine is so important. Bounce the ball, breathe, and go.")],
        [(A, "Some lovely tennis so far."), (B, "Both players are moving beautifully. It's a pleasure to watch.")],
    ],
    'filler.clay': [[(B, "Look at the marks on the court. Every slide tells a story on clay.")]],
    'filler.grass': [[(B, "The grass is starting to wear behind the baseline. The bounce will get trickier.")]],
    'filler.hard': [[(B, "The ball is really skidding through on this hard court.")]],
}
WORDS = ['love', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']
POOLS = {
    'intro.generic': [(A, "Good afternoon, and welcome to centre court."), (A, "Welcome along. A full house here today."), (A, "Welcome. The players are out, and so are we.")],
    'intro.QUARTER-FINAL': [(A, "Welcome to this quarter-final. A place in the last four is on the line.")],
    'intro.SEMI-FINAL': [(A, "Welcome to the semi-final. The winner goes through to the final.")],
    'intro.FINAL': [(A, "Welcome to the final. It doesn't get any bigger than this.")],
    'preview.clay': [(B, "On this clay, patience is everything. Expect long points and plenty of sliding.")],
    'preview.grass': [(B, "On grass the ball stays low and quick. Serving well will be crucial.")],
    'preview.hard': [(B, "This hard court is playing true. It rewards anyone who takes the ball early.")],
    'preview.generic': [(B, "Two very different styles. I think this could be a cracking contest."), (B, "I'm expecting long rallies today. Neither player gives much away.")],
    'start': [(A, "Let's get underway."), (A, "Here we go."), (A, "And we're underway.")],
    'react.level': [(B, "Very little to separate them so far."), (B, "Neck and neck."), (B, "Nothing in it at the moment.")],
    'react.close': [(B, "Still all to play for."), (B, "A narrow lead. One break could change everything.")],
    'react.big': [(B, "A commanding lead now."), (B, "That's a big gap to close.")],
}
for x in range(1, 7):
    POOLS[f'score.all.{x}'] = [(A, f"{WORDS[x].capitalize()} all.")]
for x in range(1, 8):
    for y in range(0, x):
        POOLS[f'score.{x}-{y}'] = [(A, f"{WORDS[x].capitalize()} games to {WORDS[y]}.")]

voice = PiperVoice.load(MODEL)
SR = voice.config.sample_rate


def mp3(a):
    a = a / (np.abs(a).max() + 1e-9) * 0.89
    with tempfile.TemporaryDirectory() as d:
        w = Path(d) / 'l.wav'
        with wave.open(str(w), 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
            f.writeframes(np.clip(np.round(a * 32767), -32768, 32767).astype('<i2').tobytes())
        out = Path(d) / 'l.mp3'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(w), '-ac', '1', '-ar', '22050', '-b:a', '40k', str(out)], check=True)
        return base64.b64encode(out.read_bytes()).decode()


def trim(a):
    env = np.abs(a)
    on = np.where(env > 0.02 * env.max())[0]
    a = a[max(0, on[0] - 200):min(len(a), on[-1] + 1500)].copy()
    a[:100] *= np.linspace(0, 1, 100)
    a[-600:] *= np.linspace(1, 0, 600)
    return a


clips, seconds = {}, 0.0
for cat, lines in LINES.items():
    clips[cat] = []
    for text in lines:
        per = []
        for sid in VOICES:
            cfg = SynthesisConfig(speaker_id=sid, length_scale=0.93, noise_scale=0.6, noise_w_scale=0.7)
            a = trim(np.concatenate([c.audio_float_array for c in voice.synthesize(text, syn_config=cfg)]).astype(np.float64))
            seconds += len(a) / SR
            per.append(mp3(a))
        clips[cat].append({'text': text, 'voices': per})
    print(f'{cat:18s} {len(lines)} lines')

def render(v, text):
    global seconds
    cfg = SynthesisConfig(speaker_id=VOICES[v], length_scale=0.93, noise_scale=0.6, noise_w_scale=0.7)
    a = trim(np.concatenate([c.audio_float_array for c in voice.synthesize(text, syn_config=cfg)]).astype(np.float64))
    seconds += len(a) / SR
    return {'v': v, 'text': text, 'clip': mp3(a)}


exchanges = {cat: [[render(v, t) for v, t in seq] for seq in seqs] for cat, seqs in EXCHANGES.items()}
print('exchanges', sum(len(x) for x in EXCHANGES.values()))
pools = {name: [render(v, t) for v, t in lines] for name, lines in POOLS.items()}
print('pools', len(pools))

head = ('// Generated by tools/build-commentary.py: match commentary, MP3 in base64, two voices per line.\n'
        '// Voice: Piper TTS, en-us-libritts-high model (trained on LibriTTS, CC BY 4.0).\n')
out = Path(__file__).resolve().parent.parent / 'src' / 'assets' / 'commentary.js'
out.write_text(head + 'export default ' + json.dumps({'clips': clips, 'exchanges': exchanges, 'pools': pools}) + ';\n')
print(f'wrote {out} {out.stat().st_size // 1024} KB, {seconds:.0f} s of speech')
