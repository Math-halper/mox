# How computers work

A computer is a machine that stores instructions and data, then executes instructions one step at a time very quickly. Everything else — screens, networks, apps — builds on that idea.

## Core parts

- CPU (central processing unit): executes instructions. Cores let it work on several instruction streams at once; clock speed (GHz) is how many cycles per second; caches (L1, L2, L3) hold recently used data close to the processor.
- RAM (memory): fast, volatile working space. Contents vanish when power is lost.
- Storage: SSD or hard disk, persistent. SSDs have no moving parts and are much faster than spinning disks.
- GPU: thousands of small cores optimized for parallel arithmetic — graphics, simulation, and machine learning.
- Motherboard: connects components through buses.
- Power supply and cooling: deliver energy and remove heat.
- Input/output devices: keyboard, mouse, display, speakers, network adapters.

## Binary and data representation

Computers use two voltage states, 0 and 1 — bits. Eight bits make a byte (256 values). Hexadecimal (base 16) is a shorthand: one hex digit equals four bits.

- Text is encoded with Unicode; UTF-8 stores common characters in one byte and others in two to four.
- Integers are stored in fixed widths (8, 16, 32, 64 bits) using two's complement for negatives.
- Floating point (IEEE 754) stores numbers as sign, exponent, and mantissa; rounding makes 0.1 + 0.2 equal 0.30000000000000004 in many languages.
- Images are pixel grids of color channels; video adds time; audio is a sequence of samples.

## The instruction cycle

Fetch → decode → execute → write back. Instructions are simple: add two registers, load from memory, jump to another address. Programs are long sequences of these, plus calls into the operating system.

Machine code is the CPU's native language; assembly is a readable version of it; high-level languages are translated by compilers or interpreters into machine code.

## Operating systems

An OS manages hardware and provides services: process scheduling, memory allocation (virtual memory and paging), file systems, device drivers, users and permissions, and networking.

- A process is a running program with its own memory; a thread is a sequence of execution inside a process. Threads share memory, which makes coordination necessary.
- Virtual memory maps each process's addresses to physical RAM and can page idle data to disk.
- The kernel runs in privileged mode; applications run in user mode and request services through system calls.
- Common families: Windows, macOS, Linux (and Android, which uses the Linux kernel), plus iOS.

## How programs run

Source code → compiler or interpreter → execution. Some languages compile to bytecode for a virtual machine (Java, C#); some are compiled just-in-time (JavaScript engines such as V8). Memory is managed manually (C, C++) or automatically by a garbage collector (Python, JavaScript, Go, Java).

## Performance basics

- Complexity: how work grows with input size — O(1), O(log n), O(n), O(n log n), O(n²), O(2ⁿ).
- Latency numbers to reason with: RAM access ~100 nanoseconds, SSD read ~100 microseconds, disk seek ~10 milliseconds, network round trip across a continent ~50–150 milliseconds.
- Caches and locality matter: sequential access is much faster than random access.
- Parallelism uses multiple cores; concurrency interleaves tasks even on one core.
- Bottlenecks: improving the slowest part helps; speeding up a part that is only 5% of the time cannot help much (Amdahl's law).

## Files, formats, and sizes

1 byte = 8 bits; 1 KB = 1,024 bytes; 1 MB ≈ 1 million bytes; 1 GB ≈ 1 billion bytes. A text page is a few KB; a phone photo 2–5 MB; an hour of HD video several GB.

Common formats: .txt plain text, .md Markdown, .csv tabular text, .json structured data, .html web page, .png/.jpg images, .pdf fixed-layout document, .zip compressed archive.

Compression removes redundancy: lossless (ZIP, PNG) preserves exact data; lossy (JPEG, MP3) discards detail humans notice less.

## Modern hardware notes

Batteries, thermal throttling, and power limits often matter more than specifications. More RAM helps multitasking; SSDs help startup and file work; a faster GPU helps games, video, and local AI. Virtual machines and containers run software in isolation on shared hardware.
