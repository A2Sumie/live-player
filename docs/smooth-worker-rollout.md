# Smooth Worker rollout

Use this when a live-player release should be uploaded first, inspected, and then shifted onto production traffic gradually.

## Upload without switching traffic

```bash
npm run deploy:upload
```

The command builds the OpenNext bundle, uploads assets, and creates a deployable Worker version. It does not replace the active production deployment by itself.

Find the new version id:

```bash
npm run deploy:versions
```

Check the active production split:

```bash
npm run deploy:status
```

## Dry-run the traffic split

Replace the ids with the current production version and the newly uploaded version.

```bash
npm run deploy:rollout:dry -- <old-version-id>@95 <new-version-id>@5
```

## Roll out

Start small:

```bash
npm run deploy:rollout -- <old-version-id>@95 <new-version-id>@5
```

Then promote after checking the site:

```bash
npm run deploy:rollout -- <old-version-id>@50 <new-version-id>@50
npm run deploy:rollout -- <new-version-id>@100
```

## Roll back

Send all production traffic back to the previous version:

```bash
npm run deploy:rollout -- <old-version-id>@100
```

`npm run deploy` and `npm run deploy:direct` remain the one-step full deploy path for urgent fixes.
