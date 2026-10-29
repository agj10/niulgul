# Project workflow

- Production is the existing Railway `niulgul` service connected to `https://github.com/agj10/niulgul`, using `main`. Its web server must stay in the foreground and listen on `0.0.0.0` using `PORT`.
- After completing and validating requested changes, commit them and push to `origin/main`. Check the remote commit before reporting that a push succeeded. Never force-push or overwrite remote work.
- Test browser behavior in the ChatGPT in-app browser. Do not use Chrome or Sites.
- Preserve the upstream Rust face transformation and fluid simulation logic in `vendor/obamify/`.
- Keep the README and user-facing explanations brief. Do not put deployment plans or work logs in the README.

