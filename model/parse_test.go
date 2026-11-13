package model

import (
	"fmt"
	"strings"
	"testing"
)

// TestParseINPPersistsLateSections reproduces the stale-pointer bug: with enough
// nodes/links to force slice reallocation, the COORDINATES / QUALITY / STATUS /
// VERTICES sections (parsed after all nodes/links are added) must still land on
// the right elements.
func TestParseINPPersistsLateSections(t *testing.T) {
	var b strings.Builder
	const n = 40
	b.WriteString("[JUNCTIONS]\n")
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "J%d\t100\t0\n", i)
	}
	b.WriteString("[RESERVOIRS]\nR0\t200\n")
	b.WriteString("[TANKS]\nT0\t100\t10\t0\t20\t50\t0\n")
	b.WriteString("[PIPES]\n")
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "P%d\tJ%d\tJ%d\t100\t12\t100\t0\tOpen\n", i, i, (i+1)%n)
	}
	b.WriteString("[STATUS]\nP5\tCLOSED\n")
	b.WriteString("[QUALITY]\nJ7\t0.5\nR0\t1\n")
	b.WriteString("[COORDINATES]\nJ7\t12.5\t34.5\nR0\t1\t2\nT0\t3\t4\n")
	b.WriteString("[VERTICES]\nP5\t5.5\t6.6\nP5\t7.7\t8.8\n")
	b.WriteString("[OPTIONS]\nUnits\tGPM\nQuality\tTrace\tJ7\n")

	net := ParseINP(b.String())
	node := map[string]Node{}
	for _, nd := range net.Nodes {
		node[nd.ID] = nd
	}
	link := map[string]Link{}
	for _, lk := range net.Links {
		link[lk.ID] = lk
	}

	if got := node["J7"]; got.X != 12.5 || got.Y != 34.5 {
		t.Fatalf("J7 coordinates lost: x=%v y=%v", got.X, got.Y)
	}
	if got := node["J7"].InitQual; got != 0.5 {
		t.Fatalf("J7 InitQual = %v, want 0.5", got)
	}
	if got := node["R0"]; got.X != 1 || got.Y != 2 || got.InitQual != 1 {
		t.Fatalf("R0 late-section values lost: %+v", got)
	}
	if got := node["T0"]; got.X != 3 || got.Y != 4 {
		t.Fatalf("T0 coordinates lost: %+v", got)
	}
	if got := link["P5"].Status; got != "CLOSED" {
		t.Fatalf("P5 status = %q, want CLOSED", got)
	}
	if v := link["P5"].Vertices; len(v) != 2 || v[0].X != 5.5 || v[1].Y != 8.8 {
		t.Fatalf("P5 vertices lost: %+v", v)
	}
	if net.Quality.TraceNode != "J7" {
		t.Fatalf("TraceNode = %q, want J7", net.Quality.TraceNode)
	}
}

// TestParseINPOptionCase checks that option keywords match case-insensitively
// while case-sensitive identifiers (TRACE node, chemical name) keep their case.
func TestParseINPOptionCase(t *testing.T) {
	inp := "[JUNCTIONS]\nLake\t100\t0\n[OPTIONS]\nunits\tgpm\nheadloss\th-w\nquality\ttrace\tLake\n"
	net := ParseINP(inp)
	if net.Options.FlowUnits != "GPM" {
		t.Fatalf("FlowUnits = %q, want GPM", net.Options.FlowUnits)
	}
	if net.Options.HeadLoss != "H-W" {
		t.Fatalf("HeadLoss = %q, want H-W", net.Options.HeadLoss)
	}
	if net.Quality.Type != "TRACE" || net.Quality.TraceNode != "Lake" {
		t.Fatalf("quality = %+v, want TRACE with node Lake (case preserved)", net.Quality)
	}
}

func TestParseINPChemCase(t *testing.T) {
	net := ParseINP("[OPTIONS]\nQuality\tChlorine\tmg/L\n")
	if net.Quality.Type != "CHEM" || net.Quality.ChemName != "Chlorine" || net.Quality.ChemUnits != "mg/L" {
		t.Fatalf("chem quality = %+v, want Chlorine mg/L (case preserved)", net.Quality)
	}
}