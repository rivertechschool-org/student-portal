#!/usr/bin/env python3
"""Math graduation plan: the 65 required core skills and the four branches.

Writes two files, both sources of truth from then on:
  data/math_graduation_plan.json  -- every plan item, which domain it sits in,
                                     and the Dojo skills (graph node ids) that
                                     must ALL be mastered to complete it
  data/math_curriculum_v2.json    -- the skills the plan needed that did not
                                     exist yet, appended as new graph nodes
                                     with their prerequisites

Run once to add the plan; re-running is safe (existing nodes are updated in
place, never duplicated). Afterwards run:
  node tools/compile-dojo-graph.js     (the Dojo's embedded graph + plan)
  node tools/compile-math-graph.js     (portal graph + backend seed)

How a skill is classed (derived, never typed by hand -- see compile-dojo-graph):
  core        listed under one of the 65 core items
  readiness   listed under Stage 7 (items 66-73, College & Assessment
              Readiness), or needed by one, and not core
  foundation  not listed, but a prerequisite (at any depth) of a core skill,
              or an unlisted elementary skill (Tier 4 and below)
  branch      listed only under branch items, and not needed by core
  enrichment  unlisted Tier 5-6: optional practice at core level
  beyond      unlisted Tier 7+: advanced electives
The rules the compiler enforces: a core skill never needs a readiness or branch
skill, and a readiness skill never needs a branch-only skill.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUR = os.path.join(ROOT, 'data', 'math_curriculum_v2.json')
PLAN = os.path.join(ROOT, 'data', 'math_graduation_plan.json')

cur = json.load(open(CUR, encoding='utf-8'))
by_title = {n['title']: n for n in cur['nodes']}

# ---------------------------------------------------------------------------
# New skills. (title, tier, cluster, stage, grade band, prerequisites by title,
# mastery criteria). Prerequisites may name other new skills defined earlier
# OR later in this list; they are resolved after all are created.
# ---------------------------------------------------------------------------
A, I, M = 'Application', 'Integration', 'Mastery'
NEW = [
  # ---- Core: closing the gaps in the 65 ----
  ('Percent Increase and Decrease', 4, 'Pre-Algebra', A, '7', ['Percent Change', 'Percentages'],
   'Finds percent increase and decrease, markups, tips and discounts, and the percent change between two values.'),
  ('Rate of Change', 4, 'Pre-Algebra', A, '8', ['Unit Rates and Percent Applications', 'Coordinate Plane'],
   'Finds and interprets a rate of change from a table, a graph, two points or a situation.'),
  ('Linear Representations', 5, 'Algebra 1', A, '8-9', ['Graphing Linear Equations', 'Writing Linear Equations'],
   'Moves between a situation, a table, a graph and an equation for the same linear relationship.'),
  ('Linear Modeling', 5, 'Algebra 1', A, '9', ['Writing Linear Equations', 'Rate of Change'],
   'Builds y = mx + b from a real situation, interprets slope and intercept in context, and uses it to predict.'),
  ('Exponential Growth and Decay', 5, 'Algebra 1', A, '9', ['Exponential Functions', 'Percent Increase and Decrease'],
   'Models repeated percent increase and decrease with a(1 ± r)^t and tells growth from decay.'),
  ('Quadratic Graphs and Vertices', 5, 'Algebra 1', A, '9', ['Quadratic Equations', 'Basic Functions'],
   'Reads a parabola: vertex, axis of symmetry, direction, roots and y-intercept, from a graph or an equation.'),
  ('Modeling with Functions', 5, 'Algebra 1', I, '9-10',
   ['Linear Modeling', 'Exponential Growth and Decay', 'Quadratic Graphs and Vertices'],
   'Chooses a linear, exponential or quadratic model for a situation, uses it, and judges whether the answer makes sense.'),
  ('Metric and Customary Conversion', 3, 'Intermediate Arithmetic', A, '5-6', ['Unit Conversion', 'Decimals'],
   'Converts within the metric system and between metric and US customary units.'),
  ('Dimensional Analysis', 4, 'Pre-Algebra', A, '7-8', ['Metric and Customary Conversion', 'Rates and Speed-Distance-Time'],
   'Tracks units through a calculation with conversion factors and uses units to check an answer.'),
  ('Composite Area', 4, 'Geometry', A, '6-7', ['Area', 'Perimeter'],
   'Finds the area of composite shapes by adding and subtracting rectangles, triangles and circles.'),
  ('Scale Drawings and Maps', 4, 'Geometry', A, '7', ['Proportions', 'Similar Figures'],
   'Reads and makes scale drawings and maps, converting between drawing and real lengths and areas.'),
  ('Questioning Data', 4, 'Statistics', A, '7-8', ['Data Collection', 'Mean Median Mode', 'Sampling Methods'],
   'Interprets displays and asks whether data supports a claim: source, sample, scale and missing context.'),
  ('Comparing Function Families', 7, 'Algebra 2', I, '10-11',
   ['Quadratic Graphs and Vertices', 'Exponential Growth and Decay', 'Piecewise Functions'],
   'Recognises and compares linear, quadratic, exponential, absolute-value and piecewise functions from equations, tables and graphs.'),
  ('Multi-Step Problem Solving', 5, 'Mathematical Application', I, '8-9',
   ['Multi-Step Equations', 'Percent Increase and Decrease', 'Rates and Speed-Distance-Time'],
   'Solves unfamiliar problems that need several skills in sequence, and keeps track of what each step found.'),
  ('Estimation and Reasonableness', 4, 'Mathematical Application', A, '6-8', ['Estimation', 'Scientific Notation'],
   'Estimates before calculating and judges whether a result is reasonable in size, sign and units.'),
  ('Calculator Fluency', 4, 'Mathematical Application', A, '7-8', ['Order of Operations', 'Scientific Notation'],
   'Enters calculations correctly (order of operations, parentheses, negatives, exponents) and reads calculator output including E notation.'),
  ('Spreadsheet Formulas', 5, 'Mathematical Application', A, '8-9',
   ['Evaluating Expressions', 'Order of Operations', 'Mean Median Mode'],
   'Reads and writes spreadsheet formulas: cell references, SUM/AVERAGE, relative and absolute references when filled.'),
  ('Personal Finance', 5, 'Mathematical Application', A, '9', ['Financial Math', 'Percent Increase and Decrease'],
   'Applies math to wages, paychecks, deductions, budgets, unit prices and simple debt.'),
  ('Mathematical Communication', 6, 'Mathematical Application', I, '9-10', ['Proofs', 'Multi-Step Equations'],
   'Chooses a correct justification, finds the error in a worked solution, and states a conclusion with units and context.'),
  ('Applied Math Capstone', 6, 'Mathematical Application', M, '11-12',
   ['Multi-Step Problem Solving', 'Modeling with Functions', 'Personal Finance', 'Composite Area', 'Questioning Data'],
   'Solves substantial real-world scenarios that draw on several areas of mathematics at once.'),

  # ---- STEM: thin spots ----
  ('Radical Equations', 7, 'Algebra 2', I, '10-11', ['Simplifying Radicals and Radical Operations', 'Multi-Step Equations'],
   'Solves equations containing square and cube roots and checks for extraneous solutions.'),
  ('Advanced Modeling', 7, 'Algebra 2', M, '11',
   ['Modeling with Functions', 'Exponential and Logarithmic Functions', 'Comparing Function Families'],
   'Selects and builds polynomial, exponential, logarithmic and rational models and evaluates their fit.'),
  ('Trig Equations', 8, 'Pre-Calculus', I, '11-12', ['Unit Circle', 'Inverse Trig', 'Trig Identities'],
   'Solves trigonometric equations on an interval and in general form.'),
  ('Logarithmic and Exponential Models', 8, 'Pre-Calculus', I, '11-12',
   ['Solving Exponential and Logarithmic Equations', 'Exponential Growth and Decay'],
   'Models half-life, doubling time, continuous growth, pH and decibels with exponentials and logarithms.'),
  ('Separable Differential Equations', 9, 'Calculus', M, '12', ['Differential Equations', 'U-Substitution'],
   'Solves separable differential equations, including exponential growth and decay, with initial conditions.'),
  ('Calculus Modeling', 9, 'Calculus', M, '12', ['Related Rates', 'Optimization', 'Fundamental Theorem of Calculus'],
   'Applies derivatives and integrals to scientific and technical situations: rates, accumulation, net change.'),

  # ---- Stage 7: College & Assessment Readiness (items 66-73) ----
  ('Quadratics by Square Roots', 7, 'Algebra 2', A, '10-11', ['Quadratic Equations', 'Square Roots'],
   'Solves x^2 = k and (x - h)^2 = k by square roots, including two, one or no real solutions, and picks the best method for a quadratic.'),
  ('Rational Expression Arithmetic', 7, 'Algebra 2', A, '10-11', ['Rational Expression Operations', 'Fraction Operations'],
   'Multiplies, divides, adds and subtracts basic algebraic fractions and states the excluded values.'),
  ('Extraneous Solutions', 7, 'Algebra 2', I, '10-11', ['Solving Rational Equations', 'Radical Equations'],
   'Solves rational and radical equations, checks every candidate, and rejects values that zero a denominator or fail the original equation.'),
  ('Nonlinear Function Analysis', 7, 'Algebra 2', I, '10-11',
   ['Domain and Range', 'Quadratic Graphs and Vertices', 'Advanced Polynomials', 'Exponential Growth and Decay'],
   'Finds domain, range, intercepts, maximum or minimum, increasing and decreasing intervals and end behaviour of quadratic, polynomial, exponential and absolute-value functions.'),
  ('Nonlinear Modeling', 7, 'Algebra 2', M, '10-11', ['Modeling with Functions', 'Comparing Function Families'],
   'Chooses between linear, quadratic and exponential models from data and situations, builds the model, and uses it to predict and judge fit.'),

  # ---- Business, Finance & Data ----
  ('Successive Percent Changes', 6, 'Financial Mathematics', A, '10-12', ['Percent Increase and Decrease'],
   'Combines repeated or stacked percent changes and finds the overall change.'),
  ('Loans and Amortization', 7, 'Financial Mathematics', I, '10-12', ['Compound Interest', 'Personal Finance'],
   'Uses the loan payment formula and amortization tables to split payments into principal and interest.'),
  ('Credit Card Math', 6, 'Financial Mathematics', A, '10-12', ['Personal Finance', 'Compound Interest'],
   'Calculates credit-card interest from APR, minimum payments and the true cost of carrying a balance.'),
  ('Mortgages', 7, 'Financial Mathematics', I, '10-12', ['Loans and Amortization'],
   'Calculates and compares mortgage payments, total interest, down payments and loan terms.'),
  ('Investment Returns', 6, 'Financial Mathematics', A, '10-12', ['Percent Increase and Decrease', 'Compound Interest'],
   'Calculates gains, losses, return on investment and average annual return.'),
  ('Inflation and Purchasing Power', 6, 'Financial Mathematics', A, '10-12', ['Successive Percent Changes', 'Compound Interest'],
   'Adjusts prices for inflation and compares purchasing power across years.'),
  ('Tax Calculations', 6, 'Financial Mathematics', A, '10-12', ['Personal Finance', 'Percent Increase and Decrease'],
   'Estimates income tax with brackets, sales tax and property tax, and tells marginal from effective rate.'),
  ('Revenue and Expenses', 6, 'Financial Mathematics', A, '10-12', ['Linear Equations', 'Percent Increase and Decrease'],
   'Builds revenue and cost expressions and analyses money entering and leaving a business.'),
  ('Profit and Break-Even', 6, 'Financial Mathematics', I, '10-12', ['Revenue and Expenses', 'Systems of Equations'],
   'Finds profit and the break-even point from revenue and cost models.'),
  ('Margins and Markups', 6, 'Financial Mathematics', A, '10-12', ['Revenue and Expenses', 'Percent Increase and Decrease'],
   'Calculates markup and margin, tells them apart, and sets prices to hit a target.'),
  ('Financial Ratios', 7, 'Financial Mathematics', I, '10-12', ['Revenue and Expenses', 'Ratio and Proportion'],
   'Uses profit margin, current ratio, debt-to-income and similar ratios to judge financial health.'),
  ('Financial Spreadsheets', 7, 'Financial Mathematics', M, '10-12',
   ['Spreadsheet Formulas', 'Loans and Amortization', 'Revenue and Expenses'],
   'Reads and builds spreadsheet models for budgets, balances and loan schedules.'),
  ('Data Collection Methods', 6, 'Statistics', A, '10-12', ['Questioning Data', 'Sampling Methods'],
   'Chooses surveys, observation, experiments or census, and writes unbiased questions.'),
  ('Experimental Design', 6, 'Statistics', I, '10-12', ['Data Collection Methods'],
   'Designs experiments with control groups, random assignment, replication and blinding.'),
  ('Probability Distributions', 7, 'Statistics', I, '10-12', ['Compound Probability', 'Mean Median Mode'],
   'Builds and reads discrete probability distributions, including binomial, and finds their mean.'),
  ('Normal Distribution Applications', 7, 'Statistics', I, '10-12', ['Standard Deviation and Spread'],
   'Uses the empirical rule and the normal curve to estimate proportions and percentiles.'),
  ('Choosing Data Displays', 6, 'Statistics', A, '10-12',
   ['Histograms and Five-Number Summary', 'Scatter Plots', 'Questioning Data'],
   'Chooses the right graph for the data and the question, and reads it correctly.'),
  ('Misleading Statistics', 6, 'Statistics', I, '10-12', ['Questioning Data', 'Choosing Data Displays'],
   'Spots truncated axes, cherry-picked ranges, misleading averages and correlation-as-causation.'),
  ('Spreadsheet Data Analysis', 7, 'Statistics', I, '10-12', ['Spreadsheet Formulas', 'Standard Deviation and Spread'],
   'Analyses a dataset with AVERAGE, MEDIAN, COUNTIF, STDEV and sorting/filtering.'),
  ('Data-Based Decisions', 7, 'Statistics', M, '10-12',
   ['Misleading Statistics', 'Correlation and Trend Lines', 'Experimental Design'],
   'Uses evidence to support or reject a decision and states how strong that evidence is.'),
  ('Forecasting', 7, 'Business Modeling', I, '10-12', ['Correlation and Trend Lines', 'Linear Modeling'],
   'Forecasts from trend lines, moving averages and growth rates, and knows the limits of extrapolation.'),
  ('Business Growth Models', 7, 'Business Modeling', I, '10-12', ['Exponential Growth and Decay', 'Linear Modeling'],
   'Models business, population or customer growth and compares linear with exponential growth.'),
  ('Cost-Benefit Analysis', 7, 'Business Modeling', I, '10-12', ['Profit and Break-Even'],
   'Compares the costs and benefits of options, including payback period and net benefit.'),
  ('Expected Value Decisions', 7, 'Business Modeling', I, '10-12', ['Probability Distributions'],
   'Uses expected value to compare uncertain choices: insurance, warranties, games and investments.'),
  ('Risk Analysis', 8, 'Business Modeling', M, '10-12', ['Expected Value Decisions', 'Standard Deviation and Spread'],
   'Quantifies risk as probability times impact and compares options by both expected value and spread.'),
  ('Constrained Optimization', 8, 'Business Modeling', M, '10-12', ['Systems of Inequalities', 'Profit and Break-Even'],
   'Finds the best solution within constraints by testing the corners of a feasible region.'),
  ('Scenario Modeling', 8, 'Business Modeling', M, '10-12', ['Cost-Benefit Analysis', 'Forecasting', 'Spreadsheet Formulas'],
   'Compares best, expected and worst cases when the assumptions in a model change.'),

  # ---- Trades & Technical ----
  ('Precision Measurement', 6, 'Technical Mathematics', A, '10-12', ['Basic Measurement', 'Decimals'],
   'Reads rulers to 1/16 inch, metric rules to the millimetre, calipers and micrometers.'),
  ('Measurement Fractions', 6, 'Technical Mathematics', A, '10-12', ['Precision Measurement', 'Fraction Operations'],
   'Adds, subtracts, halves and converts fractional inch measurements fluently.'),
  ('Decimal Tolerances', 6, 'Technical Mathematics', A, '10-12', ['Precision Measurement', 'Comparing and Rounding Decimals'],
   'Interprets plus/minus tolerances and decides whether a part is within spec.'),
  ('Technical Drawings', 6, 'Technical Mathematics', I, '10-12', ['Scale Drawings and Maps', 'Measurement Fractions'],
   'Reads scaled plans and dimensioned drawings and finds missing dimensions.'),
  ('Mixtures and Material Ratios', 6, 'Technical Mathematics', A, '10-12', ['Ratio and Proportion', 'Unit Conversion'],
   'Calculates mixes and dilutions: concrete, fuel, paint, chemicals.'),
  ('Trade Formulas', 6, 'Technical Mathematics', A, '10-12', ['Literal Equations', 'Evaluating Expressions'],
   'Uses trade formulas correctly: Ohm\'s law, board feet, tank capacity, gear and pulley ratios.'),
  ('Error and Tolerance', 6, 'Technical Mathematics', I, '10-12', ['Decimal Tolerances', 'Percentages'],
   'Calculates absolute, relative and percent error and judges whether it is acceptable.'),
  ('Significant Figures', 6, 'Technical Mathematics', A, '10-12', ['Precision Measurement', 'Scientific Notation'],
   'Counts significant figures and reports calculated measurements at the right precision.'),
  ('Applied Area', 7, 'Applied Geometry', A, '10-12', ['Composite Area', 'Measurement Fractions'],
   'Calculates material areas for real jobs, subtracting openings and converting to square feet or yards.'),
  ('Applied Volume', 7, 'Applied Geometry', A, '10-12', ['Volume of Cylinders Cones Spheres', 'Dimensional Analysis'],
   'Calculates volumes of combined and irregular objects in job units such as cubic yards and gallons.'),
  ('Pythagorean Layout', 7, 'Applied Geometry', A, '10-12', ['Triangles and Pythagorean Theorem', 'Measurement Fractions'],
   'Uses 3-4-5 squaring, diagonals and rafter lengths in layout and construction.'),
  ('Applied Trigonometry', 7, 'Applied Geometry', I, '10-12', ['Trigonometric Ratios'],
   'Uses trig for heights, distances, angles of elevation and depression, and ramp or ladder angles.'),
  ('Roof Pitch and Angles', 7, 'Applied Geometry', I, '10-12', ['Slope', 'Trigonometric Ratios'],
   'Converts between pitch (rise in 12), slope, percent and angle.'),
  ('Rise, Run and Grade', 7, 'Applied Geometry', A, '10-12', ['Slope', 'Percentages'],
   'Calculates percent grade, incline and elevation change for ramps, roads, drains and stairs.'),
  ('Irregular Shapes', 7, 'Applied Geometry', I, '10-12', ['Composite Area', 'Applied Area'],
   'Breaks irregular shapes into measurable sections and estimates areas from offsets.'),
  ('Coordinate Layout', 7, 'Applied Geometry', A, '10-12', ['Coordinate Plane', 'Distance and Midpoint Formulas'],
   'Locates points from a datum with coordinates and offsets, and finds distances between them.'),
  ('Material Estimation', 7, 'Applied Geometry', I, '10-12', ['Applied Area', 'Applied Volume'],
   'Determines how many boards, sheets, bags or yards a job needs, rounding up to whole units.'),
  ('Waste Factors', 7, 'Applied Geometry', I, '10-12', ['Material Estimation', 'Percent Increase and Decrease'],
   'Adds waste and overage allowances and works out yield from stock lengths.'),
  ('Load and Rate Calculations', 8, 'Technical Modeling', I, '10-12', ['Trade Formulas', 'Rates and Speed-Distance-Time'],
   'Calculates flow rates, electrical loads, fill and drain times, and weight loads.'),
  ('Proportional Scaling', 8, 'Technical Modeling', I, '10-12', ['Similar Figures', 'Technical Drawings'],
   'Enlarges or reduces designs and recipes correctly, including area and volume scaling.'),
  ('Production Rates', 8, 'Technical Modeling', A, '10-12', ['Rates and Speed-Distance-Time', 'Dimensional Analysis'],
   'Calculates output over time, combined work rates and time to finish a job.'),
  ('Cost Estimation', 8, 'Technical Modeling', I, '10-12', ['Material Estimation', 'Waste Factors'],
   'Estimates project material and labour costs with markup and tax.'),
  ('Efficiency', 8, 'Technical Modeling', A, '10-12', ['Production Rates', 'Percentages'],
   'Compares useful output with resources consumed: efficiency %, fuel economy, energy use.'),
  ('Spreadsheet Estimating', 8, 'Technical Modeling', M, '10-12', ['Spreadsheet Formulas', 'Cost Estimation'],
   'Builds and reads technical estimates in spreadsheets: quantities, unit costs, totals.'),
  ('Technical Charts', 8, 'Technical Modeling', A, '10-12', ['Trade Formulas', 'Decimal Tolerances'],
   'Reads specification tables, span tables, wire-gauge charts and performance graphs.'),
  ('Technical Capstone', 8, 'Technical Modeling', M, '10-12',
   ['Cost Estimation', 'Pythagorean Layout', 'Applied Trigonometry', 'Technical Charts'],
   'Completes multi-part technical projects from drawing to material list to cost.'),

  # ---- Computer Science & Game Mathematics ----
  ('Binary Numbers', 6, 'Computational Mathematics', A, '10-12', ['Place Value Understanding', 'Exponents'],
   'Converts between binary, decimal and hexadecimal and counts what n bits can represent.'),
  ('Boolean Logic', 6, 'Computational Mathematics', A, '10-12', ['Inequalities'],
   'Evaluates AND, OR, NOT and XOR expressions, builds truth tables and simplifies conditions.'),
  ('Screen Coordinates', 6, 'Computational Mathematics', A, '10-12', ['Coordinate Plane', 'Transformations'],
   'Uses pixel coordinates with y pointing down, origins, offsets and converting to and from math coordinates.'),
  ('Functions in Code', 6, 'Computational Mathematics', A, '10-12', ['Function Notation and Evaluation', 'Order of Operations'],
   'Traces variables, functions, loops and integer division the way a program evaluates them.'),
  ('Randomness in Code', 6, 'Computational Mathematics', A, '10-12', ['Simple Probability', 'Functions in Code'],
   'Turns random() into ranges and integers and finds the probability of each outcome.'),
  ('Computational Estimation', 6, 'Computational Mathematics', A, '10-12', ['Estimation and Reasonableness', 'Exponents'],
   'Approximates efficiently: orders of magnitude, powers of two, iterations and storage sizes.'),
  ('Game Vectors', 7, 'Games & Simulations', A, '10-12', ['Screen Coordinates', 'Triangles and Pythagorean Theorem'],
   'Uses 2D vectors for movement: components, adding, scaling, length and normalising.'),
  ('Direction and Rotation', 7, 'Games & Simulations', I, '10-12', ['Game Vectors', 'Trigonometric Ratios'],
   'Finds headings and angles between objects and converts angles to direction vectors.'),
  ('Velocity in Games', 7, 'Games & Simulations', A, '10-12', ['Game Vectors', 'Rates and Speed-Distance-Time'],
   'Updates position from velocity per frame and per second, with frame time.'),
  ('Acceleration in Games', 7, 'Games & Simulations', I, '10-12', ['Velocity in Games'],
   'Updates velocity from acceleration, gravity and friction, step by step.'),
  ('Collision Detection', 7, 'Games & Simulations', I, '10-12',
   ['Screen Coordinates', 'Distance and Midpoint Formulas', 'Inequalities'],
   'Decides when rectangles, circles and points overlap.'),
  ('Interpolation', 7, 'Games & Simulations', A, '10-12', ['Functions in Code', 'Percentages'],
   'Uses linear interpolation (lerp) to find values, positions and colours between known points.'),
  ('Probability Systems', 7, 'Games & Simulations', I, '10-12', ['Randomness in Code', 'Compound Probability'],
   'Builds drop tables and repeated-roll systems and finds the chance of at least one success.'),
  ('Weighted Randomness', 7, 'Games & Simulations', I, '10-12', ['Probability Systems'],
   'Converts weights to probabilities and picks outcomes with cumulative weights.'),
  ('Difficulty Scaling', 7, 'Games & Simulations', I, '10-12',
   ['Functions in Code', 'Linear Modeling', 'Exponential Growth and Decay'],
   'Designs and compares linear, exponential and capped difficulty curves.'),
  ('Exponential Progression', 7, 'Games & Simulations', I, '10-12', ['Exponential Growth and Decay', 'Functions in Code'],
   'Builds and analyses levelling curves: XP per level, total XP and growth factors.'),
  ('Economy Balancing', 7, 'Games & Simulations', M, '10-12', ['Exponential Progression', 'Ratio and Proportion'],
   'Balances prices, rewards and resource rates so progress takes the intended time.'),
  ('Matrix Transformations', 8, 'Advanced Computational Mathematics', I, '10-12',
   ['Matrix Operations', 'Trigonometric Ratios', 'Transformations'],
   'Uses 2x2 matrices to scale, reflect and rotate points.'),
  ('3D Coordinates', 8, 'Advanced Computational Mathematics', A, '10-12', ['Screen Coordinates', 'Distance and Midpoint Formulas'],
   'Locates points in 3D, finds 3D distance and midpoint, and reads axis conventions.'),
  ('Dot and Cross Products', 8, 'Advanced Computational Mathematics', I, '10-12', ['Game Vectors', '3D Coordinates'],
   'Uses the dot product for angles and facing, and the cross product for perpendiculars and turn direction.'),
  ('Graph Theory', 8, 'Advanced Computational Mathematics', I, '10-12', ['Functions in Code'],
   'Models networks with vertices and edges: degree, paths, cycles and shortest paths.'),
  ('Algorithmic Complexity', 8, 'Advanced Computational Mathematics', I, '10-12', ['Functions in Code', 'Exponential Progression'],
   'Compares how algorithms scale with Big-O: constant, logarithmic, linear, quadratic, exponential.'),
  ('Simulation and Modeling', 8, 'Advanced Computational Mathematics', M, '10-12',
   ['Randomness in Code', 'Velocity in Games', 'Spreadsheet Formulas'],
   'Steps a simple simulation through its states and predicts its behaviour.'),
]

# ---------------------------------------------------------------------------
# The plan. Each item: (code, title, description, [skill titles]). An item is
# complete when every listed skill is mastered.
# ---------------------------------------------------------------------------
CORE = [
  ('1', 'Number Sense & Arithmetic', [
    ('1', 'Whole-Number Operations', 'Add, subtract, multiply, and divide whole numbers accurately.',
     ['Multi-Digit Addition', 'Multi-Digit Subtraction', 'Multiplication', 'Division', 'Long Division']),
    ('2', 'Decimal Operations', 'Perform all four operations with decimals.', ['Decimals', 'Decimal Operations']),
    ('3', 'Fraction Understanding', 'Compare, order, simplify, and interpret fractions and mixed numbers.',
     ['Basic Fractions', 'Equivalent Fractions', 'Simplifying Fractions', 'Mixed Numbers', 'Comparing and Ordering Fractions']),
    ('4', 'Fraction Operations', 'Add, subtract, multiply, and divide fractions.',
     ['Fraction Operations', 'Multiplying Fractions', 'Dividing Fractions', 'Advanced Fractions']),
    ('5', 'Fractions, Decimals & Percents', 'Convert between all three forms.', ['Fraction-Decimal-Percent Conversion']),
    ('6', 'Percent of a Quantity', 'Calculate a percentage of a number.', ['Percentages', 'Unit Rates and Percent Applications']),
    ('7', 'Percent Change', 'Calculate discounts, markups, tax, tips, increases, and decreases.',
     ['Percent Change', 'Percent Increase and Decrease']),
    ('8', 'Ratios & Proportions', 'Use proportional relationships to find unknown values.', ['Ratio and Proportion', 'Proportions']),
    ('9', 'Rates & Unit Rates', 'Compare quantities such as price per ounce, speed, or hourly wage.',
     ['Unit Rates and Percent Applications', 'Rates and Speed-Distance-Time']),
    ('10', 'Positive & Negative Numbers', 'Calculate with signed numbers and interpret gains, losses, debt, temperature, etc.',
     ['Integers', 'Integer Operations', 'Negatives']),
  ]),
  ('2', 'Expressions & Equations', [
    ('11', 'Order of Operations', 'Evaluate expressions in the correct mathematical order.', ['Order of Operations']),
    ('12', 'Variables & Expressions', 'Represent unknown quantities using variables and algebraic expressions.',
     ['Expressions with Variables', 'Basic Algebraic Expressions']),
    ('13', 'Evaluate Expressions', 'Substitute values into expressions and formulas.', ['Evaluating Expressions']),
    ('14', 'Combine Like Terms', 'Simplify expressions by combining compatible terms.', ['Combining Like Terms']),
    ('15', 'Distributive Property', 'Expand and simplify expressions using distribution.', ['Distributive Property']),
    ('16', 'One-Step Equations', 'Solve equations requiring one inverse operation.', ['One-Step Equations']),
    ('17', 'Multi-Step Equations', 'Solve equations involving several operations.', ['Two-Step Equations', 'Multi-Step Equations']),
    ('18', 'Rearrange Formulas', 'Solve a formula for any desired variable.', ['Literal Equations']),
    ('19', 'Inequalities', 'Solve and graph ranges of possible solutions.', ['Inequalities', 'Graphing Linear Inequalities']),
  ]),
  ('3', 'Linear Relationships', [
    ('20', 'Coordinate Plane', 'Plot and interpret points on a coordinate grid.', ['Coordinate Plane']),
    ('21', 'Rate of Change', 'Understand how one quantity changes relative to another.', ['Rate of Change']),
    ('22', 'Slope', 'Calculate and interpret slope.', ['Slope']),
    ('23', 'Linear Equations', 'Understand and use equations such as y = mx + b.',
     ['Linear Equations', 'Graphing Linear Equations', 'x- and y-Intercepts']),
    ('24', 'Linear Representations', 'Move between situations, tables, graphs, and equations.',
     ['Writing Linear Equations', 'Linear Representations']),
    ('25', 'Linear Modeling', 'Build a linear equation from a real situation.', ['Linear Modeling']),
    ('26', 'Systems of Equations', 'Determine where two relationships intersect and interpret the result.',
     ['Systems of Equations', 'Systems by Graphing', 'Systems by Substitution', 'Systems by Elimination']),
  ]),
  ('4', 'Functions & Nonlinear Relationships', [
    ('27', 'Functions', 'Understand input-output relationships and function notation.',
     ['Basic Functions', 'Function Notation and Evaluation', 'Domain and Range']),
    ('28', 'Exponents', 'Calculate with powers and basic exponent rules.', ['Exponents']),
    ('29', 'Scientific Notation', 'Represent and calculate with extremely large or small numbers.', ['Scientific Notation', 'Powers of 10']),
    ('30', 'Roots & Radicals', 'Understand square roots and basic radical expressions.', ['Square Roots', 'Cube Roots', 'Radicals']),
    ('31', 'Exponential Growth & Decay', 'Understand repeated percentage increases and decreases.',
     ['Exponential Functions', 'Exponential Growth and Decay']),
    ('32', 'Polynomial Basics', 'Understand and perform basic operations with polynomials.', ['Polynomials']),
    ('33', 'Quadratic Relationships', 'Understand parabolas, roots, vertices, and simple quadratic equations.',
     ['Quadratic Equations', 'Quadratic Graphs and Vertices']),
    ('34', 'Mathematical Modeling', 'Turn real situations into mathematical models and evaluate the answer.', ['Modeling with Functions']),
  ]),
  ('5', 'Measurement & Geometry', [
    ('35', 'Measurement', 'Accurately measure common physical quantities.', ['Basic Measurement', 'Comparing Lengths', 'Mass and Capacity']),
    ('36', 'Unit Conversion', 'Convert measurements between common units.', ['Unit Conversion', 'Metric and Customary Conversion']),
    ('37', 'Dimensional Reasoning', 'Track units through calculations and use them to check answers.', ['Dimensional Analysis']),
    ('38', 'Perimeter & Circumference', 'Calculate distance around shapes and circles.', ['Perimeter', 'Circles']),
    ('39', 'Area', 'Calculate the area of common and composite shapes.', ['Area', 'Area and Perimeter', 'Composite Area']),
    ('40', 'Surface Area', 'Calculate the exterior area of three-dimensional objects.', ['Surface Area']),
    ('41', 'Volume', 'Calculate the amount of space inside three-dimensional objects.', ['Volume', 'Volume of Cylinders Cones Spheres']),
    ('42', 'Angle Relationships', 'Understand and calculate common angle relationships.', ['Angle Relationships', 'Parallel Lines and Transversals']),
    ('43', 'Triangle Properties', 'Use relationships between triangle sides and angles.', ['Classifying Triangles', 'Triangle Inequality']),
    ('44', 'Pythagorean Theorem', 'Find missing sides and distances in right triangles.', ['Triangles and Pythagorean Theorem']),
    ('45', 'Similarity & Proportions', 'Use proportional relationships between similar figures.', ['Similar Figures', 'Similarity']),
    ('46', 'Scale Drawings & Maps', 'Read and create scaled representations.', ['Scale Drawings and Maps']),
    ('47', 'Coordinate Geometry', 'Use coordinates to calculate slope, midpoint, distance, and geometric relationships.',
     ['Distance and Midpoint Formulas', 'Coordinate Geometry']),
    ('48', 'Transformations', 'Understand translations, rotations, reflections, and dilations.',
     ['Transformations', 'Translations', 'Reflections', 'Rotations', 'Dilations']),
    ('49', 'Geometric Reasoning', 'Explain why geometric conclusions are true.', ['Proofs', 'Triangle Congruence']),
  ]),
  ('6', 'Data, Probability & Advanced Core', [
    ('50', 'Data Literacy', 'Organize, display, interpret, and question data.', ['Data Collection', 'Questioning Data']),
    ('51', 'Quadratic Solving', 'Solve quadratic equations using appropriate methods.',
     ['Factoring Trinomials', 'Quadratic Formula', 'Completing the Square']),
    ('52', 'Function Families', 'Recognize and compare linear, quadratic, exponential, absolute-value, and piecewise functions.',
     ['Piecewise Functions', 'Comparing Function Families']),
    ('53', 'Advanced Exponents & Radicals', 'Work with rational exponents and more complex radicals.',
     ['Rational Exponents', 'Simplifying Radicals and Radical Operations']),
    ('54', 'Right-Triangle Trigonometry', 'Use sine, cosine, and tangent to find sides and angles.', ['Trigonometric Ratios']),
    ('55', 'Circle Geometry', 'Understand arcs, sectors, chords, tangents, and circle-angle relationships.',
     ['Circles', 'Inscribed Angles', 'Arc Length', 'Sector Area', 'Tangent Lines']),
    ('56', 'Statistical Distribution & Variation', 'Interpret quartiles, IQR, standard deviation, outliers, and spread.',
     ['Box Plots', 'Standard Deviation and Spread', 'Histograms and Five-Number Summary']),
    ('57', 'Bivariate Data & Inference', 'Analyze relationships between variables, sampling, bias, and correlation.',
     ['Scatter Plots', 'Two-Way Tables', 'Sampling Methods', 'Correlation and Trend Lines']),
    ('58', 'Probability', 'Calculate and interpret simple, compound, and conditional probabilities.',
     ['Simple Probability', 'Compound Probability', 'Conditional Probability']),
  ]),
  ('7', 'Mathematical Application', [
    ('59', 'Multi-Step Problem Solving', 'Solve unfamiliar problems that require several mathematical skills.', ['Multi-Step Problem Solving']),
    ('60', 'Estimation & Reasonableness', 'Estimate results and determine whether answers make sense.',
     ['Estimation', 'Estimation and Reasonableness']),
    ('61', 'Calculator & Technology Fluency', 'Use calculators and digital math tools appropriately.', ['Calculator Fluency']),
    ('62', 'Spreadsheet Mathematics', 'Use spreadsheet formulas, calculations, graphs, and tables.', ['Spreadsheet Formulas']),
    ('63', 'Financial Mathematics', 'Apply math to wages, taxes, budgets, debt, loans, savings, and investing.',
     ['Financial Math', 'Compound Interest', 'Personal Finance']),
    ('64', 'Mathematical Communication', 'Clearly explain mathematical reasoning and conclusions.', ['Mathematical Communication']),
    ('65', 'Applied Math Capstone', 'Solve a substantial real-world problem using multiple areas of mathematics.', ['Applied Math Capstone']),
  ]),
]

# Stage 7: after the universal 1-65 trunk, before specialization, for the
# students who need it (college entry, placement and assessment readiness).
READINESS = [
  ('7', 'College & Assessment Readiness', [
    ('66', 'Polynomial Operations', 'Add, subtract and multiply polynomials.', ['Polynomial Operations']),
    ('67', 'Polynomial Factoring', 'Factor common quadratic and polynomial expressions.',
     ['GCF Factoring', 'Factoring by Grouping', 'Difference of Squares']),
    ('68', 'Advanced Quadratics', 'Solve and analyze quadratics using factoring, square roots and the quadratic formula.',
     ['Quadratics by Square Roots', 'Quadratic Formula', 'Discriminant', 'Vertex Form and Quadratic Graphing']),
    ('69', 'Rational Expressions', 'Simplify and manipulate basic algebraic fractions.',
     ['Rational Expression Operations', 'Rational Expression Arithmetic']),
    ('70', 'Rational & Radical Equations', 'Solve basic equations containing fractions or radicals and check extraneous answers.',
     ['Solving Rational Equations', 'Radical Equations', 'Extraneous Solutions']),
    ('71', 'Advanced Function Analysis', 'Analyze domain, range, intercepts, extrema and behavior of nonlinear functions.',
     ['Nonlinear Function Analysis', 'Advanced Polynomials']),
    ('72', 'Function Transformations', 'Understand how equation changes move, stretch and reflect graphs.', ['Function Transformations']),
    ('73', 'Nonlinear Modeling', 'Select between linear, quadratic and exponential models for real situations.', ['Nonlinear Modeling']),
  ]),
]

BRANCHES = [
  ('A', 'STEM / College Mathematics', 'STEM', '#4f8cff', [
    ('8A', 'Algebra II', [
      ('66A', 'Advanced Polynomial Operations', 'Add, subtract, multiply, and manipulate complex polynomials.',
       ['Polynomial Operations', 'Advanced Polynomials']),
      ('67A', 'Polynomial Factoring', 'Break complex polynomial expressions into factors.',
       ['GCF Factoring', 'Factoring by Grouping', 'Difference of Squares']),
      ('68A', 'Polynomial Division', 'Divide one polynomial by another.', ['Polynomial Long Division', 'Synthetic Division']),
      ('69A', 'Rational Expressions', 'Simplify and calculate expressions containing algebraic fractions.', ['Rational Expression Operations']),
      ('70A', 'Rational Equations', 'Solve equations containing rational expressions.', ['Solving Rational Equations']),
      ('71A', 'Complex Numbers', 'Calculate using numbers involving i = √−1.', ['Complex Numbers', 'Complex Number Operations']),
      ('72A', 'Advanced Radical Equations', 'Solve equations involving roots and radicals.', ['Radical Equations']),
      ('73A', 'Exponential Equations', 'Solve equations where variables appear in exponents.', ['Solving Exponential and Logarithmic Equations']),
      ('74A', 'Logarithms', 'Understand logarithms as the inverse of exponentiation.',
       ['Exponential and Logarithmic Functions', 'Logarithm Properties']),
      ('75A', 'Logarithmic Equations', 'Solve equations involving logarithms.', ['Solving Exponential and Logarithmic Equations']),
      ('76A', 'Function Composition', 'Combine functions by placing one function inside another.', ['Composition of Functions']),
      ('77A', 'Inverse Functions', 'Find and interpret functions that reverse another function.', ['Inverse Functions']),
      ('78A', 'Polynomial Functions', 'Analyze graphs and behavior of higher-degree polynomials.',
       ['Advanced Polynomials', 'Factor and Remainder Theorem']),
      ('79A', 'Rational Functions', 'Analyze functions involving ratios of polynomials.', ['Rational Functions', 'Asymptotes']),
      ('80A', 'Advanced Modeling', 'Select and create sophisticated mathematical models.', ['Advanced Modeling']),
    ]),
    ('9A', 'Precalculus', [
      ('81A', 'Radians', 'Measure angles using radians instead of degrees.', ['Radian Measure']),
      ('82A', 'Unit Circle', 'Use the unit circle to understand trigonometric values.', ['Unit Circle']),
      ('83A', 'Trigonometric Functions', 'Work with sine, cosine, tangent, and related functions.', ['Trigonometry', 'Inverse Trig']),
      ('84A', 'Trig Graphs', 'Graph and interpret periodic trigonometric functions.', ['Graphing Trig Functions']),
      ('85A', 'Trig Identities', 'Use relationships between trigonometric expressions.', ['Trig Identities']),
      ('86A', 'Trig Equations', 'Solve equations containing trigonometric functions.', ['Trig Equations']),
      ('87A', 'Law of Sines', 'Solve non-right triangles using sine relationships.', ['Law of Sines']),
      ('88A', 'Law of Cosines', 'Solve non-right triangles using cosine relationships.', ['Law of Cosines']),
      ('89A', 'Vectors', 'Represent quantities with magnitude and direction.', ['Vectors']),
      ('90A', 'Sequences', 'Analyze ordered patterns of numbers.', ['Arithmetic Sequences', 'Geometric Sequences', 'Sequence and Series']),
      ('91A', 'Series', 'Calculate sums of sequences.', ['Sigma Notation', 'Series Convergence']),
      ('92A', 'Advanced Growth Models', 'Model exponential and logarithmic situations.', ['Logarithmic and Exponential Models']),
      ('93A', 'Conic Sections', 'Understand circles, ellipses, parabolas, and hyperbolas.',
       ['Conic Sections', 'Parabolas', 'Ellipses', 'Hyperbolas']),
      ('94A', 'Advanced Function Transformations', 'Analyze how changes to equations alter graphs.',
       ['Function Transformations', 'Advanced Functions']),
      ('95A', 'Introduction to Limits', 'Understand values approached by functions.', ['Limits']),
    ]),
    ('10A', 'Calculus', [
      ('96A', 'Limits', 'Calculate and interpret limits.', ['Limits']),
      ('97A', 'Continuity', 'Determine whether functions behave continuously.', ['Continuity']),
      ('98A', 'Derivative Concept', 'Understand derivatives as instantaneous rates of change.', ['Derivatives']),
      ('99A', 'Derivative Rules', 'Calculate derivatives using standard rules.', ['Power Rule', 'Chain Rule', 'Product Rule', 'Quotient Rule']),
      ('100A', 'Rates of Change', 'Apply derivatives to changing quantities.', ['Related Rates', 'Implicit Differentiation']),
      ('101A', 'Optimization', 'Find maximum and minimum values.', ['Optimization']),
      ('102A', 'Motion Applications', 'Analyze position, velocity, and acceleration.', ['Applications of Derivatives']),
      ('103A', 'Integral Concept', 'Understand integration as accumulation.', ['Integrals']),
      ('104A', 'Basic Integration', 'Calculate basic integrals.', ['Definite and Indefinite Integrals', 'U-Substitution']),
      ('105A', 'Area Under Curves', 'Use integration to calculate accumulated area.', ['Area Between Curves']),
      ('106A', 'Fundamental Theorem of Calculus', 'Understand the connection between derivatives and integrals.', ['Fundamental Theorem of Calculus']),
      ('107A', 'Differential Equations Introduction', 'Model relationships involving changing quantities.',
       ['Differential Equations', 'Separable Differential Equations']),
      ('108A', 'Calculus Modeling', 'Apply calculus to real scientific and technical problems.', ['Calculus Modeling', 'Volumes of Revolution']),
    ]),
  ]),
  ('B', 'Business, Finance & Data', 'Business', '#2fbf71', [
    ('8B', 'Financial Mathematics', [
      ('66B', 'Advanced Percent Change', 'Analyze repeated or complex percentage changes.', ['Successive Percent Changes']),
      ('67B', 'Compound Interest', 'Calculate growth when interest earns additional interest.', ['Compound Interest', 'Investments and Growth']),
      ('68B', 'Loans & Amortization', 'Understand loan payments, principal, and interest.', ['Loans and Amortization']),
      ('69B', 'Credit Calculations', 'Analyze credit-card balances, interest, and repayment.', ['Credit Card Math']),
      ('70B', 'Mortgages', 'Calculate and compare home-financing costs.', ['Mortgages']),
      ('71B', 'Investment Returns', 'Calculate gains, losses, and rates of return.', ['Investment Returns']),
      ('72B', 'Inflation', 'Understand changes in purchasing power over time.', ['Inflation and Purchasing Power']),
      ('73B', 'Taxes', 'Estimate and analyze common forms of taxation.', ['Tax Calculations']),
      ('74B', 'Revenue & Expenses', 'Analyze money entering and leaving a business.', ['Revenue and Expenses']),
      ('75B', 'Profit & Break-Even', 'Determine profitability and break-even points.', ['Profit and Break-Even']),
      ('76B', 'Margins & Markups', 'Calculate product margins and pricing.', ['Margins and Markups']),
      ('77B', 'Financial Ratios', 'Use ratios to evaluate business or financial performance.', ['Financial Ratios']),
      ('78B', 'Financial Spreadsheets', 'Build spreadsheet models for financial decisions.', ['Financial Spreadsheets']),
    ]),
    ('9B', 'Statistics & Data', [
      ('79B', 'Data Collection', 'Gather useful and reliable data.', ['Data Collection Methods']),
      ('80B', 'Sampling Methods', 'Understand how representative samples are selected.', ['Sampling Methods']),
      ('81B', 'Experimental Design', 'Design experiments that produce useful evidence.', ['Experimental Design']),
      ('82B', 'Probability Distributions', 'Understand how probabilities are distributed across possible outcomes.', ['Probability Distributions']),
      ('83B', 'Normal Distribution', 'Interpret data using the normal curve.', ['Normal Distribution Applications']),
      ('84B', 'Standard Deviation', 'Measure how spread out data is.', ['Standard Deviation and Spread']),
      ('85B', 'Z-Scores', 'Compare values based on their distance from the mean.', ['Normal Distribution']),
      ('86B', 'Regression', 'Create mathematical models describing relationships in data.', ['Regression']),
      ('87B', 'Correlation', 'Measure the strength and direction of relationships.', ['Correlation and Trend Lines']),
      ('88B', 'Confidence & Uncertainty', 'Understand that statistical conclusions contain uncertainty.', ['Confidence Intervals']),
      ('89B', 'Statistical Significance', 'Understand when results may represent more than random variation.', ['Hypothesis Testing']),
      ('90B', 'Data Visualization', 'Present data clearly using appropriate graphs and charts.', ['Choosing Data Displays']),
      ('91B', 'Misleading Statistics', 'Identify manipulation or poor interpretation of data.', ['Misleading Statistics']),
      ('92B', 'Spreadsheet Data Analysis', 'Analyze datasets using spreadsheets.', ['Spreadsheet Data Analysis']),
      ('93B', 'Data-Based Decisions', 'Use evidence to support decisions.', ['Data-Based Decisions']),
    ]),
    ('10B', 'Business Modeling', [
      ('94B', 'Forecasting', 'Use past information to estimate future outcomes.', ['Forecasting']),
      ('95B', 'Growth Models', 'Model business, population, or financial growth.', ['Business Growth Models']),
      ('96B', 'Cost-Benefit Analysis', 'Compare expected costs and benefits.', ['Cost-Benefit Analysis']),
      ('97B', 'Expected Value', 'Calculate average expected outcomes under uncertainty.', ['Expected Value', 'Expected Value Decisions']),
      ('98B', 'Risk Analysis', 'Quantify and compare risks.', ['Risk Analysis']),
      ('99B', 'Optimization', 'Find the best solution within constraints.', ['Constrained Optimization']),
      ('100B', 'Scenario Modeling', 'Compare outcomes when assumptions change.', ['Scenario Modeling']),
    ]),
  ]),
  ('C', 'Trades & Technical', 'Trades', '#f5a524', [
    ('8C', 'Technical Mathematics', [
      ('66C', 'Precision Measurement', 'Measure accurately using technical tools.', ['Precision Measurement']),
      ('67C', 'Measurement Fractions', 'Work fluently with fractional measurements.', ['Measurement Fractions']),
      ('68C', 'Decimal Tolerances', 'Interpret acceptable measurement variation.', ['Decimal Tolerances']),
      ('69C', 'Metric & US Conversion', 'Convert between measurement systems.', ['Metric and Customary Conversion']),
      ('70C', 'Technical Drawings', 'Read and use scaled plans and diagrams.', ['Technical Drawings']),
      ('71C', 'Ratios & Mixtures', 'Calculate mixtures, proportions, and material ratios.', ['Mixtures and Material Ratios']),
      ('72C', 'Applied Formulas', 'Use trade-specific formulas correctly.', ['Trade Formulas']),
      ('73C', 'Unit Analysis', 'Track and convert units in technical calculations.', ['Dimensional Analysis']),
      ('74C', 'Error & Tolerance', 'Determine acceptable measurement error.', ['Error and Tolerance']),
      ('75C', 'Significant Figures', 'Report measurements at appropriate precision.', ['Significant Figures']),
    ]),
    ('9C', 'Applied Geometry', [
      ('76C', 'Advanced Area', 'Calculate material areas for complex shapes.', ['Applied Area']),
      ('77C', 'Advanced Volume', 'Calculate volumes of irregular or combined objects.', ['Applied Volume']),
      ('78C', 'Applied Pythagorean Theorem', 'Use right triangles in layout and construction.', ['Pythagorean Layout']),
      ('79C', 'Applied Trigonometry', 'Use trig to determine heights, angles, and distances.', ['Applied Trigonometry']),
      ('80C', 'Angles & Slopes', 'Calculate pitch, slope, and angle.', ['Roof Pitch and Angles']),
      ('81C', 'Rise, Run & Grade', 'Calculate incline and elevation change.', ['Rise, Run and Grade']),
      ('82C', 'Circles & Arcs', 'Calculate curved measurements used in technical work.', ['Arc Length', 'Sector Area']),
      ('83C', 'Irregular Shapes', 'Break complex shapes into measurable sections.', ['Irregular Shapes']),
      ('84C', 'Coordinate Layout', 'Locate objects accurately using coordinates.', ['Coordinate Layout']),
      ('85C', 'Material Estimation', 'Determine quantities of materials needed.', ['Material Estimation']),
      ('86C', 'Waste Calculations', 'Account for cutting, loss, and excess materials.', ['Waste Factors']),
    ]),
    ('10C', 'Technical Modeling', [
      ('87C', 'Load & Rate Calculations', 'Calculate quantities changing over time or under load.', ['Load and Rate Calculations']),
      ('88C', 'Proportional Scaling', 'Enlarge or reduce technical designs correctly.', ['Proportional Scaling']),
      ('89C', 'Production Rates', 'Calculate output over time.', ['Production Rates']),
      ('90C', 'Cost Estimation', 'Estimate project material and labor costs.', ['Cost Estimation']),
      ('91C', 'Efficiency', 'Compare useful output with resources consumed.', ['Efficiency']),
      ('92C', 'Spreadsheet Estimating', 'Build technical estimates using spreadsheets.', ['Spreadsheet Estimating']),
      ('93C', 'Technical Charts', 'Interpret specification tables, graphs, and charts.', ['Technical Charts']),
      ('94C', 'Technical Capstone', 'Complete a substantial real-world technical project.', ['Technical Capstone']),
    ]),
  ]),
  ('D', 'Computer Science & Game Mathematics', 'CS & Games', '#b36bff', [
    ('8D', 'Computational Mathematics', [
      ('66D', 'Binary Numbers', 'Understand and calculate using base-2 numbers.', ['Binary Numbers']),
      ('67D', 'Boolean Logic', 'Use true/false logical operations.', ['Boolean Logic']),
      ('68D', 'Computer Coordinate Systems', 'Use coordinates to locate objects digitally.', ['Screen Coordinates']),
      ('69D', 'Variables & Functions in Computing', 'Use mathematical relationships in programs.', ['Functions in Code']),
      ('70D', 'Modulo Arithmetic', 'Work with remainders and repeating number cycles.', ['Modular Arithmetic']),
      ('71D', 'Randomness & Probability', 'Understand mathematically generated randomness.', ['Randomness in Code']),
      ('72D', 'Computational Estimation', 'Approximate solutions efficiently when exact answers are unnecessary.', ['Computational Estimation']),
    ]),
    ('9D', 'Games & Simulations', [
      ('73D', '2D Vectors', 'Represent direction and movement mathematically.', ['Game Vectors']),
      ('74D', 'Distance Calculations', 'Calculate distance between objects.', ['Distance and Midpoint Formulas']),
      ('75D', 'Direction & Angles', 'Determine orientation and rotation.', ['Direction and Rotation']),
      ('76D', 'Velocity', 'Model speed and direction.', ['Velocity in Games']),
      ('77D', 'Acceleration', 'Model changes in velocity.', ['Acceleration in Games']),
      ('78D', 'Collision Mathematics', 'Determine when game objects intersect.', ['Collision Detection']),
      ('79D', 'Interpolation', 'Smoothly calculate values between known points.', ['Interpolation']),
      ('80D', 'Probability Systems', 'Build random event systems.', ['Probability Systems']),
      ('81D', 'Weighted Randomness', 'Make some random outcomes more likely than others.', ['Weighted Randomness']),
      ('82D', 'Difficulty Scaling', 'Mathematically increase challenge over time.', ['Difficulty Scaling']),
      ('83D', 'Exponential Progression', 'Build leveling and growth systems.', ['Exponential Progression']),
      ('84D', 'Economy Balancing', 'Balance prices, rewards, resources, and progression.', ['Economy Balancing']),
    ]),
    ('10D', 'Advanced Computational Mathematics', [
      ('85D', 'Matrices', 'Organize and transform numerical information.', ['Matrices Intro', 'Matrix Operations']),
      ('86D', 'Matrix Transformations', 'Use matrices to move, rotate, and scale objects.', ['Matrix Transformations']),
      ('87D', '3D Coordinates', 'Represent locations in three-dimensional space.', ['3D Coordinates']),
      ('88D', 'Advanced Vectors', 'Perform more complex calculations involving direction and magnitude.', ['Dot and Cross Products']),
      ('89D', 'Discrete Mathematics', 'Study mathematical structures built from separate values.', ['Set Theory', 'Discrete Mathematics']),
      ('90D', 'Graph Theory', 'Model networks of connected objects.', ['Graph Theory']),
      ('91D', 'Combinatorics', 'Count possible arrangements and combinations.', ['Permutations', 'Combinations', 'Combinatorics']),
      ('92D', 'Algorithmic Complexity', 'Compare how efficiently algorithms scale.', ['Algorithmic Complexity']),
      ('93D', 'Simulation & Modeling', 'Build mathematical simulations of systems.', ['Simulation and Modeling']),
    ]),
  ]),
]

# ---------------------------------------------------------------------------
errors = []

# 1. Create or update the new nodes.
existing_ids = [int(re.sub(r'\D', '', n['id'])) for n in cur['nodes']]
next_id = max(existing_ids) + 1
new_titles = [t[0] for t in NEW]
assert len(set(new_titles)) == len(new_titles), 'duplicate new skill titles'
for title, tier, cluster, stage, grade, prereqs, criteria in NEW:
    node = by_title.get(title)
    if node is None:
        node = {'id': f'M-{next_id:03d}', 'title': title}
        next_id += 1
        cur['nodes'].append(node)
        by_title[title] = node
    elif node.get('provenance') != 'graduation_plan':
        errors.append(f'new skill "{title}" collides with an existing skill')
        continue
    node.update({
        'cluster': cluster, 'stage': stage, 'grade_band': grade,
        'mastery_criteria': criteria, 'hard_prereqs': [], 'soft_deps': [],
        'dojo_skill': title, 'dojo_tier': tier, 'provenance': 'graduation_plan', 'atomic': True,
    })
for title, tier, cluster, stage, grade, prereqs, criteria in NEW:
    node = by_title[title]
    for p in prereqs:
        if p not in by_title:
            errors.append(f'"{title}" needs unknown skill "{p}"')
            continue
        pn = by_title[p]
        if (pn.get('dojo_tier') or 0) > tier:
            errors.append(f'"{title}" (T{tier}) needs "{p}" at a higher tier (T{pn.get("dojo_tier")})')
        node['hard_prereqs'].append(pn['id'])

# 2. The plan, by node id.
def items(spec):
    out = []
    for code, title, desc, skills in spec:
        ids = []
        for s in skills:
            if s not in by_title:
                errors.append(f'plan item {code} "{title}" names unknown skill "{s}"')
            else:
                ids.append(by_title[s]['id'])
        out.append({'code': code, 'title': title, 'description': desc, 'skills': ids})
    return out

plan = {
    'version': 1,
    'note': 'Generated by tools/build-graduation-plan.py. An item is complete when every skill in it is mastered. '
            'Core items are required for every student; a branch skill unlocks as soon as its prerequisites are mastered.',
    'core': {'title': 'Graduation Core', 'domains': [
        {'id': d, 'name': name, 'items': items(spec)} for d, name, spec in CORE]},
    'readiness': {'title': 'College & Assessment Readiness', 'stage': 7,
        'note': 'After the universal 1-65 trunk, before specialization, for students who need it.',
        'domains': [{'id': d, 'name': name, 'items': items(spec)} for d, name, spec in READINESS]},
    'branches': [
        {'id': b, 'name': name, 'short': short, 'color': color, 'domains': [
            {'id': d, 'name': dname, 'items': items(spec)} for d, dname, spec in domains]}
        for b, name, short, color, domains in BRANCHES],
}
n_core = sum(len(d['items']) for d in plan['core']['domains'])
if n_core != 65:
    errors.append(f'core has {n_core} items, expected 65')
n_ready = sum(len(d['items']) for d in plan['readiness']['domains'])

if errors:
    print('\n'.join('ERROR ' + e for e in errors))
    sys.exit(1)

with open(CUR, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(cur, f, indent=1, ensure_ascii=False)
    f.write('\n')
with open(PLAN, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(plan, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f'{len(cur["nodes"])} curriculum nodes ({len(NEW)} from the plan); '
      f'{n_core} core items; {n_ready} readiness items; ' + ', '.join(f'{b["short"]} {sum(len(d["items"]) for d in b["domains"])}' for b in plan['branches']))
