package pool

import (
	"encoding/json"
	"io"
	"testing"

	"epanet-web/model"
)

// TestServeProtocol exercises the worker stdin/stdout JSON protocol in-process
// (no DLL, no subprocess): two sequential requests on one stream, then EOF.
func TestServeProtocol(t *testing.T) {
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	defer inR.Close()
	defer outR.Close()

	fake := func(n *model.Network) *model.SimResult {
		return &model.SimResult{
			OK:      true,
			Version: 20305,
			Times:   []int64{0, 3600},
			Nodes:   []model.NodeSeries{{ID: n.Nodes[0].ID}},
		}
	}
	done := make(chan struct{})
	go func() { serve(inR, outW, "", "", fake); close(done) }()

	net := &model.Network{Title: "t", Nodes: []model.Node{{ID: "J1", Type: "JUNCTION"}}}
	enc := json.NewEncoder(inW)
	dec := json.NewDecoder(outR)

	for i := 0; i < 2; i++ {
		if err := enc.Encode(net); err != nil {
			t.Fatalf("encode request %d: %v", i, err)
		}
		var res model.SimResult
		if err := dec.Decode(&res); err != nil {
			t.Fatalf("decode response %d: %v", i, err)
		}
		if !res.OK || res.Version != 20305 || len(res.Times) != 2 || len(res.Nodes) != 1 || res.Nodes[0].ID != "J1" {
			t.Fatalf("unexpected result %d: %+v", i, res)
		}
	}

	// Closing stdin must end the worker loop.
	inW.Close()
	<-done
}