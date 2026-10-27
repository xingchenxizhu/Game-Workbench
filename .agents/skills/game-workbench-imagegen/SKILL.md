---
name: game-workbench-imagegen
description: Generate game-workbench image tasks with ChatGPT native image generation, preserving task IDs and references so results return to the original image, character, map or material-pack task. Use for this workbench's image queue; not for video or audio generation.
---

Use the native image generation tool for the supplied task. The text, transparent-background requirement and attached images define the asset; references retain their supplied order and roles, including masks and edit targets.

Generate one final image per task. Do not substitute code drawings, placeholders, remote URLs or an API backend. If native image generation is unavailable, report that and stop; do not claim an image was produced.

In a workbench background worker, the host captures the structured `imageGeneration` completion, matches its thread and turn to the task, copies its exact saved file, and backfills the original task. Do not run shell commands or perform a second backfill there.

In an interactive chat, read the task's `交给ChatGPT生图.md`, inspect any local references before generating, and use the exact task ID and service address it supplies. After generation, run `tools/complete-image.ts` with that ID and the chosen generated image's absolute path. Confirm the returned task is completed and the workbench can display its result. Never find results by scanning for the newest global image; concurrent chats can generate unrelated images.

Preserve requested subject, pixel style, camera, palette, dimensions and transparency where supported. Report actual output dimensions rather than pretending model output has an exact pixel grid. Do not operate unrelated project files or read account credentials.
