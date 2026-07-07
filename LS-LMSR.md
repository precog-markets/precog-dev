LS-LMSR

In the LMSR, b is a constant. But in the LS-LMSR, it is a function of the quantities traders have wagered on each outcome:

    b(q) = alpha . Sum(qi)

At first glance, it appears that we have just shifted our problem from choosing one constant to another—now, instead of setting b > 0, we have to set alpha > 0 instead. However, alpha has a natural interpretation: because it can be shown that marginal prices in an n-event market sum to at most:

    1 + alpha . n . log(n)

We can interpret alpha as responsible for setting a market "vig" value (overround) — typically between 5 and 30 percent in real-world markets. 
Consequently, we can set:

    alpha = overround / n . log(n)

This natural parameterization gives us a valuable guide in assessing what different values of alpha produce in the resulting market.

LS-LMSR Properties
This small shift in how to set b---from a constant to an increasing value---creates a variety of curious beneficial properties:

1. Numerical Precision:
    
    Numerical precision issues are encountered very quickly with the LMSR. The problems derive from the exponentiation in the LMSR which can make even reasonably large input values infeasible. This is particularly a concern for EVM implementations, which uses a fixed-point computational system with a built-in precision limit.

    There is a trick that can be used to keep LMSR from overflowing, but the larger point is that it is non-trivial to implement LMSR in practice due to numerical problems and doubly so in a fixed-point context.

    In contrast, observe that the LS-LMSR guarantees from first principles that the exponentiated value is never greater than 1/alpha because Thus, as long as alpha is not set unnaturally small, computation is easily supported within the fixed-point framework.


2. Positive Homogeneity:

   In the LMSR, prices are determined based on the relative differences of quantities.

   In the LS-LMSR, prices are determined based on the ratio of quantities to one another. Multiplying a quantity vector by a positive constant c > 0 produces the same prices, this property is known as “positive homogeneity.”


3. Bounded Loss:

   The LS-LMSR retains the bounded loss properties of the LMSR. 

   In the LMSR this loss bound determines the maximum amount of liquidity in the market (`maxLoss = b . log(n)`). 
   
   But in the LS-LMSR, the bounded loss it's determined by the initial amount of liquidity in the market and the overround parameter (`maxLoss = initialShares . overround`). This max bound is properly explained the next document: [Maximum Loss Bound for the Liquidity-Sensitive Logarithmic Market Scoring Rule](./LS-LMSR_Max-Loss-Bound.pdf)

4. Liquidity Sensitivity:

   Observe that as the market has more activity and q increases, b increases, so market depth increases in market volume, a property that is seen in real-world markets (e.g., you can buy a million dollars of Apple stock without moving the price significantly, but buying a million dollars of a low market cap stock will change its price significantly).


5. Prices Sum to (at Least) 1:

   In the LMSR, marginal prices are positive and sum to exactly 1. This means that those prices are directly interpretable as probabilities. 

   In the LS-LMSR, prices are positive but sum to slightly more than 1. This creates a range of probability estimates compatible with the market’s prices. For instance, if marginal prices are in a two-event market are (.58, .43), this indicates that market participants believe the true probability of the first event occurring is no higher than .58 (or else participants would buy the first contract) but no lower than .57 (or else participants would buy the second contract at .43). The extra “vig” on prices can be thought of as a trader subsidy to providing increased liquidity in the future.