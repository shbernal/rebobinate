# Fixture clips

`clip.mp4` and `clip.webm` are the same four seconds of abstract animation, the
only real media in the suite. Every other fixture video is a source-less
`<video>`, which is enough to set `playbackRate` on but never actually plays —
so nothing else can prove the rate reaches decoded output.

They are committed on purpose. Together they are ~50 KB, they never change, and
generating them at test time would put ffmpeg and a network round trip on the
critical path of every CI run.

## Source

[Digital animation art with blue and pink colors](https://www.pexels.com/video/digital-animation-art-with-blue-and-pink-colors-8675550/)
by Weldi 33 Studio Design, from Pexels (video id 8675550), used under the
[Pexels License](https://www.pexels.com/license/) — free to use, no attribution
required. Recorded here anyway so the provenance survives.

## Regenerating

Pexels serves MP4 only, so the WebM is a transcode. From the 426x240 rendition:

```sh
curl -sL -o source.mp4 \
  https://videos.pexels.com/video-files/8675550/8675550-sd_426_240_30fps.mp4

ffmpeg -y -i source.mp4 -t 4 -an -vf "scale=320:180,fps=25" \
  -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p \
  -crf 32 -g 25 -movflags +faststart clip.mp4

ffmpeg -y -i source.mp4 -t 4 -an -vf "scale=320:180,fps=25" \
  -c:v libvpx-vp9 -b:v 0 -crf 40 -g 25 -row-mt 1 -deadline good clip.webm
```

The flags are chosen for the test, not for looks:

- **Four seconds** is long enough to play a stretch at 2x and still have footage
  left, and short enough to keep both files tiny.
- **No audio** keeps autoplay policy out of it. A muted video with no audio
  track plays without a user gesture.
- **`-g 25`** puts a keyframe every second so seeking lands immediately.
- **`+faststart`** moves the MP4 index to the front, so playback can begin
  before the whole file arrives.
- **320x180** is small on disk and still large enough for the badge geometry
  assertions to have room to work with.

Continuous motion matters: a static clip would still decode, but a test that
watches `currentTime` advance would pass on a frozen picture too.
