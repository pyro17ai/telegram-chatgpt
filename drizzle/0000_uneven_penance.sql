CREATE TABLE `lease` (
	`key` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
