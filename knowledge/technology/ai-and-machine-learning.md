# Artificial intelligence and machine learning

Artificial intelligence is the effort to make machines perform tasks that normally require human intelligence. Machine learning is the dominant approach: instead of writing rules, we fit a model to examples.

## Core vocabulary

- Model: a mathematical function with adjustable parameters (weights).
- Training: adjusting parameters to reduce error on examples.
- Loss function: a number measuring how wrong predictions are.
- Gradient descent: repeatedly nudge parameters in the direction that lowers loss.
- Epoch: one pass over the training data. Batch: a subset processed together. Learning rate: step size.
- Features: input variables. Labels: the correct answers in supervised learning.
- Inference: using a trained model to make a prediction.
- Overfitting: memorizing training data and failing on new data. Underfitting: too simple to capture the pattern.
- Regularization, dropout, and early stopping reduce overfitting; validation data measures generalization.

## Main kinds of learning

- Supervised: labeled examples — classification (spam or not) and regression (predict a price).
- Unsupervised: find structure without labels — clustering, dimensionality reduction, anomaly detection.
- Self-supervised: learn from the data itself by predicting hidden parts, the basis of modern language models.
- Reinforcement learning: an agent takes actions, receives rewards, and learns a policy. Used in games, robotics, and control.

## Classical algorithms

Linear and logistic regression, decision trees, random forests, gradient-boosted trees, k-nearest neighbors, naive Bayes, support vector machines, k-means clustering, and principal component analysis. For tabular data, gradient-boosted trees are often strong and inexpensive.

## Neural networks

Layers of weighted sums followed by nonlinear activations (ReLU, sigmoid, tanh). Depth allows hierarchical features. Backpropagation computes gradients efficiently by the chain rule. Common architectures: convolutional networks for images, recurrent networks for sequences, and transformers for text, audio, and now images.

## Transformers and language models

A transformer processes a sequence using attention: each token weighs the relevance of every other token. Multi-head attention captures several relationships at once. Positional information tells the model word order.

A large language model is trained to predict the next token over enormous text corpora, then fine-tuned to follow instructions and align with preferences. Parameters range from millions to hundreds of billions. Tokens are word fragments; roughly 4 characters or ¾ of a word in English. The context window is the maximum number of tokens the model can consider at once.

Generation samples from predicted probabilities; temperature controls randomness, top-p and top-k restrict the candidate pool. Quantization stores weights in 8, 4, or fewer bits to shrink models and speed inference, with some accuracy cost.

## Retrieval-augmented generation (RAG)

RAG grounds answers in documents: split text into chunks, index them, embed or keyword-match a question, retrieve relevant passages, and place them in the prompt as context. The model then answers using that context and cites sources. RAG does not change the model's weights and can be updated by editing the documents. Limitations: retrieval can miss, chunks can lose context, and the model can still misread the passages.

Embeddings map text to vectors so that similar meanings sit near each other; cosine similarity compares directions. Keyword scoring (TF-IDF, BM25) is a strong, cheap baseline and works well for rare terms.

## Evaluation and limits

Metrics: accuracy, precision, recall, F1, mean absolute error, perplexity, and human preference ratings. Always hold out test data.

Known failure modes: hallucination (confident invention), bias inherited from data, brittleness outside the training distribution, prompt sensitivity, and data leakage. Model behavior is statistical, not guaranteed.

## Local and private AI

Small models (a few hundred million to a few billion parameters) can run in a browser or on a laptop. WebGPU accelerates matrix math on the graphics card; WebAssembly provides a slower CPU fallback. Quantization makes this practical. Privacy benefit: prompts and documents stay on the device, though the weights usually were trained elsewhere.

## Responsible use

Verify important claims against sources, be transparent when content is machine-generated, avoid uploading sensitive data to services you do not trust, and remember that a language model is a text predictor, not a database of verified facts.
