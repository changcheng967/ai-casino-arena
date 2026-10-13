CREATE TABLE "arena_state" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "elo_history" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"elo" double precision NOT NULL,
	"delta" double precision NOT NULL,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hands" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"hand_no" integer NOT NULL,
	"tier_name" text NOT NULL,
	"sb" bigint NOT NULL,
	"bb" bigint NOT NULL,
	"board" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pot" bigint NOT NULL,
	"awards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"showdown" boolean DEFAULT false NOT NULL,
	"hole_cards" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"model_ref" text NOT NULL,
	"provider" text DEFAULT 'nim' NOT NULL,
	"name" text NOT NULL,
	"publisher" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"chat_capable" boolean DEFAULT true NOT NULL,
	"probe_latency_ms" integer,
	"probe_note" text,
	"elo" double precision DEFAULT 1200 NOT NULL,
	"bankroll" bigint DEFAULT 10000 NOT NULL,
	"bailouts" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"hands_played" integer DEFAULT 0 NOT NULL,
	"hands_won" integer DEFAULT 0 NOT NULL,
	"vpip_hands" integer DEFAULT 0 NOT NULL,
	"pfr_hands" integer DEFAULT 0 NOT NULL,
	"aggressive_actions" integer DEFAULT 0 NOT NULL,
	"showdowns" integer DEFAULT 0 NOT NULL,
	"showdowns_won" integer DEFAULT 0 NOT NULL,
	"net_profit" bigint DEFAULT 0 NOT NULL,
	"biggest_pot" bigint DEFAULT 0 NOT NULL,
	"malformed" integer DEFAULT 0 NOT NULL,
	"timeouts" integer DEFAULT 0 NOT NULL,
	"avg_latency_ms" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "schema_meta" (
	"version" serial PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tier_name" text NOT NULL,
	"sb" bigint NOT NULL,
	"bb" bigint NOT NULL,
	"hands" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"seats" jsonb DEFAULT '[]'::jsonb NOT NULL
);
