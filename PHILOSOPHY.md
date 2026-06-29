# TAGRO OS — The First Document

Read this before writing a single line of code.

TAGRO OS is not a service management application.
It is an attempt to express, preserve, and continually improve the way work is carried out within TAGRO.

The software exists to support people.
People do not exist to satisfy the software.

Every screen, every report, every workflow, every notification, every automation, and every AI feature
should be judged against this document.

If a proposed feature makes data collection easier but makes good work harder, it should be redesigned.

---

## Reality First

TAGRO OS is not trying to model a service centre.
It is trying to model reality.

Reality comes first.
The software follows the workshop — not the other way around.

This has one concrete consequence that must never be violated:

**Status is derived from timeline events. It is never set manually.**

If the last timeline event is `machine_received`, the status is Received.
If the last event is `repair_started`, the status is Repairing.
If the last event is `repair_completed`, the status is Ready.

The mechanic records what they did.
The system derives what state the job is in.

There is no status dropdown anywhere in TAGRO OS.

---

## Think Beyond a Service Centre

TAGRO OS is the operating system for TAGRO as a business.

Today that includes STIHL service.
Tomorrow it may include Jain Irrigation, agricultural field projects, estate management,
finance, inventory, research, or entirely new activities.

**The shell should not care.**

It should simply discover, authorise, launch, and close applications.

Design every application as a plug-in. Every application should be installable, removable,
disabled, or replaced by changing the registry — not by modifying the shell.

The shell should never need to know what an application actually does.

---

## The Shell Has Six Responsibilities

No more. No less.

1. Discover applications from the registry
2. Enforce permissions
3. Launch applications
4. Provide notifications
5. Maintain navigation
6. Provide shared services

Everything else belongs inside the application.

If logic is being added to the shell that is specific to any one application or domain,
it belongs in the application instead.

---

## Domains, Not Features

Rather than thinking in terms of service features, think in terms of business domains.

Each domain contributes applications. The shell remains unchanged.

| Domain       | Examples                                              |
|--------------|-------------------------------------------------------|
| service      | Receive, Jobs, Work, Parts, Tech                      |
| inventory    | Stock, PO, Dispatch                                   |
| sales        | Quotation, Customer, Pipeline                         |
| finance      | Bank reconciliation, Owner dashboard                  |
| irrigation   | Jain Survey, Installation tracker                     |
| agriculture  | Farm survey, Crop planning, Labour measurement        |
| field        | Field projects, Site tools                            |
| management   | Reports, Staff, Branch review                         |
| research     | Calculators, Data tools                               |
| tools        | Tool Builder, Custom forms, Utilities                 |

Adding a new domain means adding new registry entries.
The shell does not change.

---

## The Stability Principle

The shell should become more stable over time.

Almost all future development should happen by adding, improving, or removing applications —
not by rewriting the operating system itself.

**The test:**
If, a year from now, we can introduce an entirely new business activity simply by registering
a new application and granting permissions — the architecture has succeeded.

If introducing a new activity requires modifying the shell — the architecture has failed
and must be redesigned before proceeding.

---

## The Foundation

**Honesty** — represent reality as faithfully as possible.
An honest diagnosis. An honest estimate. An honest status. An honest "I don't know."
The system must never encourage pretending that work has been done when it has not.

**Cleanliness** — clarity for the next person.
A clean bench. A clean workflow. A clean interface. A clean database.
The next person should always understand where things are, what has happened, and what should happen next.

---

## The Design Test

Before adding any feature, ask these questions in order:

**0. Should this feature exist at all?**

This question comes before all others.
The correct solution is often to remove a screen, combine two steps, automate a decision,
or eliminate a field entirely.
TAGRO OS should continuously become simpler, not larger.
Deleting unnecessary code is considered progress.

**1. Does this help people represent reality more honestly?**
**2. Does this leave the workshop cleaner than before?**
**3. Does this protect attention?**
**4. Does this make the preferred way easier?**
**5. Does this help future people understand what happened?**

If the answer to question zero is no, stop.
If the answers to questions one through five are yes, continue.
If not, redesign.

---

## Engineering Rules

These apply during every build and every audit.

### 1. Architecture before features

Never fix a feature if the underlying architecture is wrong.
If a redesign of the shell or registry would simplify five future features, redesign first.
Patching on a wrong foundation produces compounding debt.

### 2. One source of truth

Every concept must have exactly one owner.

| Concept             | Owner                    |
|---------------------|--------------------------|
| App registry        | os-manifest.js `apps:`   |
| API endpoint        | os-manifest.js `api:`    |
| Role permissions    | os-manifest.js `roles:`  |
| Branch definitions  | os-manifest.js `branches:` |
| Event → status map  | os-manifest.js `statusFromEvent:` |
| Machine models      | KV: `models:all`         |
| Staff list          | KV: `staff:all`          |
| Job data            | localStorage + Dropbox sync |

No concept may have two definitions in two places.
When a duplicate is found, it must be removed before new code is written.

### 3. Every file must justify its existence

During every audit, ask:
- Why does this file exist?
- Could another file own this responsibility?
- Is this file making the system simpler or more complicated?

A file that cannot answer these questions should be deleted.

---

## The App Registry

To add an app: add one entry to `os-manifest.js`, create the HTML file. Nothing else changes.
To remove an app: delete the entry. The icon disappears. The file stays harmlessly.
To restrict by role, branch, user, or feature flag: set the `access` object.
To disable temporarily: set `enabled: false`.

The shell reads the registry. The shell never hardcodes application logic.

---

## Respect

Respect the customer.
Respect the mechanic.
Respect the next person who will work on the machine.
Respect future staff.
Respect future developers.
Respect the truth.

Technology will change.
Programming languages will change.
Artificial intelligence will change.
These principles should not.
