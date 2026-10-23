import "reflect-metadata";
import {AccessGuard} from "./access";
export {AccessGuard} from "./access";
import {ManagedController} from "./managed-api";
import {
  Body,
  CanActivate,
  Catch,
  Controller,
  ExecutionContext,
  ExceptionFilter,
  ArgumentsHost,
  Get,
  HttpException,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  ForbiddenException,
  UseGuards,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import express, { Request } from "express";
import { getAuth } from "firebase-admin/auth";
import { FieldPath } from "firebase-admin/firestore";
import { ZodError, z } from "zod";
import { listingUrl, verified, verificationSchema, verifyLead, queueGeneration, publicGeneration } from "./generation";
import {
  authorizedEmail,
  contentPatchSchema,
  CATEGORIES,
  leadSchema,
  patchSchema,
  researchSchema,
  settingsSchema,
} from "./domain";
import { db, settings, updateLead, upsertLead } from "./store";
import { integrationStatus, runDiscovery } from "./discovery";
type AuthRequest = Request & { actor: string };
@Catch()
class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (error instanceof ZodError)
      return response
        .status(400)
        .json({
          message: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
    if (error instanceof HttpException)
      return response
        .status(error.getStatus())
        .json({ message: error.message });
    const e = error as { status?: number; message?: string };
    if ([404, 409].includes(e.status || 0))
      return response.status(e.status).json({ message: e.message });
    console.error(
      "API failure",
      error instanceof Error ? error.name : "unknown",
    );
    return response
      .status(500)
      .json({ message: "The operation could not be completed. Please retry." });
  }
}
@Controller("api")
@UseGuards(AccessGuard)
class BackOfficeController {
  @Get("me") me(@Req() req: AuthRequest) {
    return { email: req.actor, categories: CATEGORIES };
  }
  @Get("leads") async leads(@Query("cursor") cursor?: string, @Query("view") view?: string) {
    let query = db()
      .collection("leads")
      .orderBy(FieldPath.documentId())
      .limit(101);
    if (cursor) {
      if (!/^[a-f0-9]{32}$/.test(cursor))
        throw new HttpException("Invalid cursor", 400);
      query = query.startAfter(cursor);
    }
    const result = await query.get();
    const rows = result.docs.slice(0, 100);
    const checks = rows.length ? await db().getAll(...rows.map(d => db().doc(`googleVerifications/${d.id}`))) : [];
    const leads = rows.map((d, i) => ({id:d.id, ...d.data(), googleVerification:checks[i].data() || null, googleVerified:verified(d.data(), checks[i].data())}));
    return {
      leads: leads.filter(l => view === "all" || (view === "unverified" ? !l.googleVerified : l.googleVerified)),
      cursor: result.size > 100 ? result.docs[99].id : null,
    };
  }
  @Post("leads") async create(@Body() body: unknown, @Req() req: AuthRequest) {
    const lead = leadSchema.parse(body);
    if (!lead.profile?.googleMapsUrl || !listingUrl(lead.profile.googleMapsUrl)) throw new HttpException("Provide an actual Google Maps listing URL; search-only leads cannot be imported.", 400);
    return upsertLead(lead, req.actor);
  }
  @Post("ingest") async ingest(@Body() body: unknown, @Req() req: AuthRequest, @Query("skipExisting") skipExisting?: string) {
    const leads = leadSchema.array().min(1).max(50).parse(body);
    if (leads.some(l => !l.profile?.googleMapsUrl || !listingUrl(l.profile.googleMapsUrl))) throw new HttpException("Every imported lead requires an actual Google Maps listing URL.", 400);
    const results = [];
    for (const lead of leads) results.push(await upsertLead(lead, req.actor, skipExisting === "true"));
    return { results };
  }
  @Post("leads/:id/verification") async verify(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthRequest) {
    this.id(id);
    return verifyLead(id, verificationSchema.parse(body), req.actor);
  }
  @Post("leads/:id/generations") async generate(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthRequest) {
    this.id(id);
    const input = z.object({expectedVersion:z.number().int().positive()}).strict().parse(body);
    return queueGeneration(id, input.expectedVersion, req.actor);
  }
  @Get("generations/:id") async generation(@Param("id") id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpException("Invalid generation ID", 400);
    const job = await db().doc(`generations/${id}`).get();
    if (!job.exists) throw new HttpException("Generation not found", 404);
    return {id, ...publicGeneration(job.data()!)};
  }
  @Post("generations/:id/retry") async retry(@Param("id") id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpException("Invalid generation ID", 400);
    await db().runTransaction(async tx => {
      const ref = db().doc(`generations/${id}`), snap = await tx.get(ref);
      if (!snap.exists) throw new HttpException("Generation not found", 404);
      const job = snap.data()!;
      const leadRef = db().doc(`leads/${job.leadId}`);
      const [lead,v] = await Promise.all([tx.get(leadRef), tx.get(db().doc(`googleVerifications/${job.leadId}`))]);
      if (job.status !== "failed" || lead.data()?.generationId !== id) throw new HttpException("Only the latest failed generation can be retried.", 409);
      if (lead.data()?.callStatus === "Do not call" || !verified(lead.data()!, v.data()) || v.data()?.identityFingerprint !== job.snapshot.identityFingerprint) throw new HttpException("Reverify the business and start a new generation.", 409);
      tx.update(ref,{status:"queued",error:null,inFlight:false,updatedAt:new Date().toISOString()});
      tx.update(leadRef,{generationStatus:"queued"});
    });
    return {id,status:"queued"};
  }
  @Get("generator/status") async generatorStatus() {
    const worker = (await db().doc("internal/generatorWorker").get()).data();
    return {online:!!worker && worker.heartbeatAt > Date.now() - 90000, lastSeen:worker?.heartbeatAt || null, ready:!!worker?.ready};
  }
  @Get("leads/:id/activity") async activity(@Param("id") id: string) {
    this.id(id);
    const result = await db()
      .collection(`leads/${id}/activity`)
      .orderBy("at", "desc")
      .limit(100)
      .get();
    return result.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  @Patch("leads/:id") async patch(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    this.id(id);
    return updateLead(id, patchSchema.parse(body), req.actor);
  }
  @Patch("leads/:id/content") async content(
    @Param("id") id: string, @Body() body: unknown, @Req() req: AuthRequest,
  ) {
    this.id(id);
    const input = contentPatchSchema.parse(body);
    await db().runTransaction(async tx => {
      const ref = db().doc(`leads/${id}`);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpException("Lead not found", 404);
      if (snap.data()!.version !== input.expectedVersion) throw new HttpException("This lead changed. Refresh before saving.", 409);
      const at = new Date().toISOString();
      tx.update(ref, {researchNotes: input.researchNotes, ...(input.profile ? {profile: input.profile} : {}), updatedAt: at, version: input.expectedVersion + 1});
      tx.create(ref.collection("activity").doc(), {actor:req.actor, at, note:"Updated business profile and research notes.", fromStatus:snap.data()!.callStatus, toStatus:snap.data()!.callStatus});
    });
    return {saved:true};
  }
  @Patch("leads/:id/research") async research(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    this.id(id);
    const input = researchSchema.parse(body);
    await db().runTransaction(async (tx) => {
      const ref = db().doc(`leads/${id}`);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpException("Lead not found", 404);
      if (snap.data()!.version !== input.expectedVersion)
        throw new HttpException(
          "This lead changed. Refresh before saving.",
          409,
        );
      const at = new Date().toISOString();
      const evidence = [
        ...(snap.data()!.evidence || []),
        {
          query: "Team website review",
          url: input.sourceUrl,
          summary: input.summary,
          checkedAt: at,
        },
      ].slice(-40);
      tx.update(ref, {
        websiteStatus: input.websiteStatus,
        websiteUrl: input.websiteUrl,
        websiteCheckedAt: at,
        evidence,
        updatedAt: at,
        version: input.expectedVersion + 1,
      });
      tx.create(ref.collection("activity").doc(), {
        actor: req.actor,
        at,
        note: `Website review: ${input.websiteStatus}. ${input.summary}`,
        fromStatus: snap.data()!.callStatus,
        toStatus: snap.data()!.callStatus,
      });
    });
    return { saved: true };
  }
  @Get("settings") async getSettings() {
    return { settings: {...await settings(),enabled:false}, integration: integrationStatus() };
  }
  @Patch("settings") async saveSettings(@Body() body: unknown) {
    const data = {...settingsSchema.parse(body),enabled:false};
    await db().doc("settings/discovery").set(data);
    return { settings: data, integration: integrationStatus() };
  }
  @Get("runs") async runs() {
    const results = await db()
      .collection("runs")
      .orderBy("startedAt", "desc")
      .limit(30)
      .get();
    return results.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  @Post("discovery/run") async run(@Req() req: AuthRequest) {
    return runDiscovery(req.actor);
  }
  private id(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id))
      throw new HttpException("Invalid lead ID", 400);
  }
}
@Module({ controllers: [BackOfficeController, ManagedController], providers: [AccessGuard] })
class BackOfficeModule {}
let serverPromise: Promise<express.Express> | undefined;
export function createApi(configure?: (server: express.Express) => void) {
  return (serverPromise ??= (async () => {
    const server = express();
    configure?.(server);
    server.disable("x-powered-by");
    server.use(express.json({ limit: "12mb" }));
    const app = await NestFactory.create(
      BackOfficeModule,
      new ExpressAdapter(server),
      { logger: ["error", "warn"] },
    );
    app.enableCors({
      origin: [
        "https://daniboy-be1c0.web.app",
        "https://daniboy-be1c0.firebaseapp.com",
        ...(process.env.FUNCTIONS_EMULATOR === "true"
          ? ["http://localhost:8081"]
          : []),
      ],
      methods: ["GET", "POST", "PATCH", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
    });
    app.useGlobalFilters(new ApiErrors());
    await app.init();
    return server;
  })());
}
