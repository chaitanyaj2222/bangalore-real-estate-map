# Project documents

Drop files for a project into a folder named after its project id:

```
web/docs/<project-id>/
```

For example, `web/docs/nischitha-jai-dhama/MARASANDRA-LAYOUT-PLAN.pdf`.

Anything placed here is picked up automatically at server start and listed in
that project's detail panel - no code or JSON change needed. Restart the server
(or `npm run dev`, which watches) after adding files.

Recognised types: `.pdf`, `.jpg`, `.jpeg`, `.png`, `.webp`.
Files starting with `.` or `_` are ignored.

The folder name must match the `id` in `server/data/projects.json` exactly.
