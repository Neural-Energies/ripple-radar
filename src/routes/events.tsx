import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TickerLink } from "@/components/desk-nav";
import { BookStateChips } from "@/components/research-header";
import { Badge, Button, Delta, Input, Panel } from "@/components/ui";
import type { EvidenceClass, Reliability } from "@/data/types";
import { regionFromText, tagsFromText, themeFromTags } from "@/lib/engine/ontology";
import { classifyText, reliabilityOf } from "@/lib/live/evidence";
import { EMPTY_HEADLINES } from "@/lib/live/empty";
import {
  runAnalyze,
  useLive,
  useLiveClusters,
  useLiveEvent,
  useLiveEvents,
} from "@/lib/live/provider";
import type { LiveCluster, LiveHeadline } from "@/lib/live/types";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/events")({ component: EventsPage });
