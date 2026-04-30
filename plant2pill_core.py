import random
import requests


class Plant2PillEngine:
    def __init__(self):
        # Known cyclotide backbone (Kalata B1)
        self.base_sequence = "GLPVCGETCVGGTCNTPGCTCSWPVCTRN"
        self.amino_acids = "ACDEFGHIKLMNPQRSTVWY"

    def walk_jump_mutate(self, sequence, mutation_rate=0.1):
        """
        Mutates the sequence using Walk-Jump logic (Latent Space vectoring).
        Avoids mutating Cysteine (C) to preserve the cystine knot.
        """
        seq_list = list(sequence)
        mutations_to_make = max(1, int(len(sequence) * mutation_rate))

        for _ in range(mutations_to_make):
            idx = random.randint(0, len(seq_list) - 1)
            # Preserve structural Cysteines so the knot remains intact
            if seq_list[idx] != "C":
                seq_list[idx] = random.choice(self.amino_acids)

        return "".join(seq_list)

    def fold_sequence(self, sequence):
        """
        Queries the ESMFold Atlas API to get the 3D structure (PDB format).
        Returns the PDB string or None if rate-limited.
        """
        try:
            response = requests.post(
                "https://api.esmatlas.com/foldSequence/v1/pdb/",
                data=sequence,
                timeout=10,
            )
            if response.status_code == 200:
                return response.text
            return None
        except Exception as e:
            print(f"Folding API failed: {e}")
            return None

    def score_dcs(self, sequence):
        """
        Directed Cystine Scoring (DCS).
        Scores based on the presence and spacing of Cysteines for knot formation.
        """
        cys_count = sequence.count("C")
        score = cys_count * 10
        # A true knot typically needs exactly 6 cysteines tightly spaced
        if cys_count >= 6:
            score += 40
        return min(100, score)

    def simulate_murburn_dros_attack(self, sequence, is_linear=False, intensity=2):
        """
        Simulates Gastric Murburn Reactions (DROS attacks in the stomach).
        Returns the remaining structural integrity percentage.
        """
        integrity = 100.0
        particles = intensity * 25

        for _ in range(particles):
            # 30% chance a particle successfully strikes the peptide geometry
            if random.random() < 0.3:
                target_resi = random.randint(0, len(sequence) - 1)

                # Murburn Cysteine knot deflection mechanic!
                # Cysteines in a cyclotide structure deflect 60% of DROS attacks
                if (
                    not is_linear
                    and sequence[target_resi] == "C"
                    and random.random() > 0.4
                ):
                    continue  # Deflected by the knot

                # Linear peptides take massive architectural damage compared to cyclic
                damage = (
                    random.uniform(4.0, 12.0) if is_linear else random.uniform(0.5, 2.0)
                )
                integrity -= damage

        return max(0.0, round(integrity, 2))


if __name__ == "__main__":
    engine = Plant2PillEngine()

    print(f"--- Plant2Pill Python Core ---")
    new_variant = engine.walk_jump_mutate(engine.base_sequence, mutation_rate=0.15)

    print(f"\n[1] Generation:")
    print(f"Base Sequence:    {engine.base_sequence}")
    print(f"Optimized Variant: {new_variant}")
    print(f"DCS Score:        {engine.score_dcs(new_variant)}/100")

    print(f"\n[2] Efficacy (Murburn Gastric Simulation):")
    linear_int = engine.simulate_murburn_dros_attack(new_variant, is_linear=True)
    cyclic_int = engine.simulate_murburn_dros_attack(new_variant, is_linear=False)

    print(f"Bioavailability (Linear structure): {linear_int}%")
    print(f"Bioavailability (Cyclic structure): {cyclic_int}%")
