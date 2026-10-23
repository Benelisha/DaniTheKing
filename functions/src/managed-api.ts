import { saveMedia } from "./media";
import { publishManaged } from "./publishing";
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  HttpException,
} from "@nestjs/common";
import { z } from "zod";
import { getStorage } from "firebase-admin/storage";
import { db } from "./store";
import { managedSettings } from "./gemini";
import {
  briefSchema,
  managedSettingsSchema,
  pageSchema,
  renderPage,
  terminal,
} from "./managed-domain";
import { startManaged, enqueueManaged } from "./managed";
import { AccessGuard } from "./access";
const idSchema = z.string().uuid();
const leadSchema = z.string().regex(/^[a-f0-9]{32}$/);
@Controller("api/managed")
@UseGuards(AccessGuard)
export class ManagedController {
  @Post("jobs/:id/publish") publish(@Param("id") id: string, @Req() req: any) {
    idSchema.parse(id);
    return publishManaged(id, req.actor);
  }
  @Post("jobs/:id/unpublish") unpublish(
    @Param("id") id: string,
    @Req() req: any,
  ) {
    idSchema.parse(id);
    return publishManaged(id, req.actor, true);
  }
  @Get("leads/:id/media") async media(@Param("id") id: string) {
    leadSchema.parse(id);
    const rows = await db().collection(`leads/${id}/media`).get();
    return Promise.all(
      rows.docs.map(async (d) => {
        const m = d.data();
        const [bytes] = await getStorage().bucket().file(m.path).download();
        return {
          ...m,
          dataUrl: `data:image/webp;base64,${bytes.toString("base64")}`,
        };
      }),
    );
  }
  @Post("leads/:id/media/upload") async upload(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    leadSchema.parse(id);
    if (!(await db().doc(`leads/${id}`).get()).exists)
      throw new HttpException("Lead not found", 404);
    const input = z
      .object({
        base64: z
          .string()
          .max(12000000)
          .regex(/^[A-Za-z0-9+/=]+$/),
        caption: z.string().max(500),
      })
      .parse(body);
    return saveMedia(
      id,
      Buffer.from(input.base64, "base64"),
      req.actor,
      input.caption,
    );
  }
  @Patch("leads/:id/media/:mediaId") async selectMedia(
    @Param("id") id: string,
    @Param("mediaId") mediaId: string,
    @Body() body: unknown,
  ) {
    leadSchema.parse(id);
    idSchema.parse(mediaId);
    const input = z.object({ selected: z.boolean() }).strict().parse(body);
    await db().doc(`leads/${id}/media/${mediaId}`).update(input);
    return { saved: true };
  }
  @Post("jobs/:id/accept-findings") async accept(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const job = await this.job(id);
    const input = z
      .object({ expectedVersion: z.number().int().positive() })
      .strict()
      .parse(body);
    if (!job.findings || !job.leadId)
      throw new HttpException("No findings to accept", 409);
    await db().runTransaction(async (tx) => {
      const ref = db().doc(`leads/${job.leadId}`),
        s = await tx.get(ref);
      if (s.data()?.version !== input.expectedVersion)
        throw new HttpException("Lead changed; refresh before accepting", 409);
      tx.update(ref, {
        peopleFindings: job.findings.people,
        researchFindings: job.findings,
        version: input.expectedVersion + 1,
      });
      tx.create(ref.collection("activity").doc(), {
        actor: req.actor,
        at: new Date().toISOString(),
        note: "Accepted sourced Gemini research findings.",
        fromStatus: s.data()!.callStatus,
        toStatus: s.data()!.callStatus,
      });
    });
    return { saved: true };
  }
  @Get("settings") async settings() {
    return managedSettings();
  }
  @Patch("settings") async saveSettings(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const config = managedSettingsSchema.parse(body);
    await db()
      .collection("managedConfigHistory")
      .add({ config, actor: req.actor, at: new Date().toISOString() });
    await db().doc("settings/managed").set(config);
    return config;
  }
  @Post("discovery") discovery(@Req() req: any) {
    return startManaged("discovery", req.actor);
  }
  @Post("leads/:id/:action") async start(
    @Param("id") id: string,
    @Param("action") action: string,
    @Req() req: any,
  ) {
    leadSchema.parse(id);
    return startManaged(
      z.enum(["research", "people", "generation"]).parse(action),
      req.actor,
      id,
    );
  }
  @Patch("leads/:id/brief") async brief(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    leadSchema.parse(id);
    const brief = briefSchema.parse(body);
    await db().doc(`leads/${id}`).update({ generationBrief: brief });
    return { saved: true };
  }
  @Get("jobs") async jobs() {
    const s = await db()
      .collection("managedJobs")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    return s.docs.map((d) => {
      const { config, ...data } = d.data();
      return { id: d.id, ...data };
    });
  }
  @Get("jobs/:id") async job(
    @Param("id") id: string,
  ): Promise<Record<string, any>> {
    idSchema.parse(id);
    const s = await db().doc(`managedJobs/${id}`).get();
    if (!s.exists) throw new HttpException("Job not found", 404);
    const { config, ...data } = s.data()!;
    return { id, ...data };
  }
  @Post("jobs/:id/cancel") async cancel(@Param("id") id: string) {
    idSchema.parse(id);
    await db().runTransaction(async (tx) => {
      const ref = db().doc(`managedJobs/${id}`),
        s = await tx.get(ref);
      if (!s.exists) throw new HttpException("Job not found", 404);
      if (terminal.has(s.data()!.status)) return;
      tx.update(ref, {
        cancelRequested: true,
        ...(s.data()!.leaseUntil > Date.now() ? {} : { status: "cancelled" }),
      });
    });
    return { saved: true };
  }
  @Post("jobs/:id/retry") async retry(@Param("id") id: string) {
    idSchema.parse(id);
    await db().runTransaction(async (tx) => {
      const ref = db().doc(`managedJobs/${id}`),
        s = await tx.get(ref);
      if (
        !s.exists ||
        !["failed", "needs_review"].includes(s.data()!.status) ||
        s.data()!.leaseUntil > Date.now()
      )
        throw new HttpException("Only stopped failed jobs can retry", 409);
      tx.update(ref, { status: "queued", error: null, cancelRequested: false });
    });
    await enqueueManaged(id);
    return { id };
  }
  @Get("jobs/:id/preview") async preview(@Param("id") id: string) {
    const job = await this.job(id);
    if (!["ready", "published"].includes(job.status))
      throw new HttpException("Draft is not ready", 409);
    const [html] = await getStorage()
      .bucket()
      .file(`managed/${job.leadId}/${id}/page.html`)
      .download();
    return { html: html.toString("utf8") };
  }
  @Patch("jobs/:id/page") async page(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const job = await this.job(id);
    if (job.status !== "ready")
      throw new HttpException(
        "Only unpublished ready drafts can be edited",
        409,
      );
    const page = pageSchema.parse(body);
    const images = [];
    for (let i = 0; i < 2; i++) {
      const f = getStorage()
        .bucket()
        .file(`managed/${job.leadId}/${id}/image-${i}.png`);
      const [[bytes], [meta]] = await Promise.all([
        f.download(),
        f.getMetadata(),
      ]);
      images.push(
        `data:${meta.contentType};base64,${bytes.toString("base64")}`,
      );
    }
    const html = renderPage(page, job.snapshot, images);
    await getStorage()
      .bucket()
      .file(`managed/${job.leadId}/${id}/page.html`)
      .save(html, { contentType: "text/html" });
    await db()
      .doc(`managedJobs/${id}`)
      .update({ page, updatedAt: new Date().toISOString() });
    return { saved: true };
  }
}
