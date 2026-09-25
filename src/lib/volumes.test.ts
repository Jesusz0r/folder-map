import assert from "node:assert/strict";
import test from "node:test";
import { assembleVolumes, type VolumeMount } from "./volumes.ts";

const startupAlias: VolumeMount = {
  name: "Macintosh HD",
  realPath: "/",
  mountPath: "/Volumes/Macintosh HD",
  totalBytes: 100,
  freeBytes: 40,
};

test("the startup disk alias in /Volumes is listed once", () => {
  const volumes = assembleVolumes([
    startupAlias,
    {
      name: "Backup",
      realPath: "/Volumes/Backup",
      mountPath: "/Volumes/Backup",
      totalBytes: 50,
      freeBytes: 10,
    },
  ]);
  assert.equal(volumes.length, 2);
  assert.deepEqual(volumes[0], {
    id: "startup",
    name: "Macintosh HD",
    path: "/",
    startup: true,
    totalBytes: 100,
    freeBytes: 40,
  });
  assert.equal(volumes[1].path, "/Volumes/Backup");
  assert.equal(volumes[1].startup, false);
});

test("a missing volume list still leaves the startup disk", () => {
  const volumes = assembleVolumes([
    {
      name: "Startup disk",
      realPath: "/",
      mountPath: "/",
      totalBytes: null,
      freeBytes: null,
    },
  ]);
  assert.equal(volumes.length, 1);
  assert.equal(volumes[0].path, "/");
  assert.equal(volumes[0].name, "Startup disk");
  assert.equal(volumes[0].startup, true);
});
