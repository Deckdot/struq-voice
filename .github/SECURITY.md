# Security policy

## Supported versions

Security fixes are provided for the latest published version of Struq Voice.
Update through the app or download the newest installer before reporting an
issue that may already be fixed.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/Deckdot/struq-voice/security/advisories/new)
so details stay private while the report is investigated.

Include the affected app version, Windows version and build, reproduction
steps, impact, and any proof of concept that is safe to share. You should
receive an acknowledgement within seven days.

## Update integrity

Struq Voice is distributed without a commercial Windows code-signing
certificate. Every update artifact is instead protected by an Ed25519
signature over its checksum and version. The installed app verifies that
signature against its embedded public key before an update can install. A
failed signature, changed checksum, or older replayed version is rejected.

## Audio and privacy

Local engines keep transcription audio on the machine. The OpenRouter cloud
engine is an explicit opt-in and sends audio to that provider only when it is
selected. Dictation audio is processed in memory and is not saved to disk.
Meeting recordings are saved locally when meeting archiving is enabled and
can be removed from the meeting library.
